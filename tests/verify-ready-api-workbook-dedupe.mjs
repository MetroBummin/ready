import assert from 'node:assert/strict';
import { test } from 'node:test';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const args = { examId: 'exam-a', passageId: 'passage-a', catalogRevision: 3 };
let moduleNumber = 0;
async function harness(t, fetchImpl) {
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
  globalThis.window = { READY_CONFIG: { API_URL: 'https://ready.invalid/api' } };
  globalThis.fetch = fetchImpl;
  t.after(() => { globalThis.window = oldWindow; globalThis.fetch = oldFetch; });
  return (await import(`../ready/api.js?dedupe-test=${++moduleNumber}`)).readyApi;
}

// No live API calls. Each test gets a fresh module and an isolated mock transport.
test('three overlapping prefetch/open reads send one HTTP request', async t => {
  const gate = deferred(); let calls = 0;
  const api = await harness(t, async () => { calls++; await gate.promise; return json({ stages: [] }); });
  const requests = Array.from({ length: 3 }, () => api('student_workbook', args, 'token-a'));
  assert.equal(calls, 1);
  gate.resolve();
  assert.equal((await Promise.all(requests)).length, 3);
});

test('consumers receive separate deeply nested response objects', async t => {
  const gate = deferred();
  const api = await harness(t, async () => { await gate.promise; return json({ stages: [{ items: [{ completed: false }] }], savedWords: [] }); });
  const first = api('student_workbook', args, 'token-a'), second = api('student_workbook', args, 'token-a');
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  a.stages[0].items[0].completed = true;
  a.savedWords.push({ lemma: 'one' });
  assert.equal(b.stages[0].items[0].completed, false);
  assert.deepEqual(b.savedWords, []);
});

test('a completed read is not cached: re-entry revalidates on the server', async t => {
  let calls = 0;
  const api = await harness(t, async () => json({ number: ++calls }));
  assert.equal((await api('student_workbook', args, 'token-a')).number, 1);
  assert.equal((await api('student_workbook', args, 'token-a')).number, 2);
});

for (const [field, value] of [['examId', 'exam-b'], ['passageId', 'passage-b'], ['catalogRevision', 4], ['canonicalRevision', 9]]) {
  test(`different ${field} request values must not share an HTTP request`, async t => {
    const gate = deferred(); let calls = 0;
    const api = await harness(t, async () => { calls++; await gate.promise; return json({}); });
    const first = api('student_workbook', args, 'token-a');
    const second = api('student_workbook', { ...args, [field]: value }, 'token-a');
    assert.equal(calls, 2); gate.resolve(); await Promise.all([first, second]);
  });
}

test('different full session tokens remain separate even with the same suffix', async t => {
  const gate = deferred(); let calls = 0;
  const api = await harness(t, async () => { calls++; await gate.promise; return json({}); });
  const a = api('student_workbook', args, 'a-same-suffix-123456'), b = api('student_workbook', args, 'b-same-suffix-123456');
  assert.equal(calls, 2); gate.resolve(); await Promise.all([a, b]);
});

test('a new login does not inherit a pending read from the previous token', async t => {
  const old = deferred();
  const api = await harness(t, async (_url, options) => {
    const authorization = options.headers.authorization;
    if (authorization === 'Bearer old-token') await old.promise;
    return json({ authorization });
  });
  const previous = api('student_workbook', args, 'old-token');
  assert.equal((await api('student_workbook', args, 'new-token')).authorization, 'Bearer new-token');
  old.resolve();
  assert.equal((await previous).authorization, 'Bearer old-token');
});

test('different endpoints do not share requests', async t => {
  const gate = deferred(); const urls = [];
  const api = await harness(t, async url => { urls.push(url); await gate.promise; return json({}); });
  const a = api('student_workbook', args, 'token-a');
  window.READY_CONFIG.API_URL = 'https://another.invalid/api';
  const b = api('student_workbook', args, 'token-a');
  assert.deepEqual(urls, ['https://ready.invalid/api', 'https://another.invalid/api']);
  gate.resolve(); await Promise.all([a, b]);
});

test('different keepalive semantics do not share requests', async t => {
  const gate = deferred(); let calls = 0;
  const api = await harness(t, async () => { calls++; await gate.promise; return json({}); });
  const a = api('student_workbook', args, 'token-a');
  const b = api('student_workbook', args, 'token-a', { keepalive: true });
  assert.equal(calls, 2); gate.resolve(); await Promise.all([a, b]);
});

test('caller-owned AbortSignals never share even the same request', async t => {
  const gate = deferred(); let calls = 0;
  const api = await harness(t, async () => { calls++; await gate.promise; return json({}); });
  const controller = new AbortController();
  const a = api('student_workbook', args, 'token-a', { signal: controller.signal });
  const b = api('student_workbook', args, 'token-a', { signal: controller.signal });
  assert.equal(calls, 2); gate.resolve(); await Promise.all([a, b]);
});

test('aborting an independent caller cannot abort the shared workbook read', async t => {
  const gate = deferred(); let calls = 0;
  const api = await harness(t, async (_url, options) => {
    calls++;
    if (options.signal) return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    await gate.promise; return json({ ok: true });
  });
  const controller = new AbortController();
  const cancellable = api('student_workbook', args, 'token-a', { signal: controller.signal });
  const sharedA = api('student_workbook', args, 'token-a'), sharedB = api('student_workbook', args, 'token-a');
  const rejected = assert.rejects(cancellable, { name: 'AbortError' });
  controller.abort(); await rejected;
  gate.resolve();
  assert.deepEqual(await Promise.all([sharedA, sharedB]), [{ ok: true }, { ok: true }]);
  assert.equal(calls, 2);
});

test('transient network retry is shared and preserves the two-attempt policy', async t => {
  let calls = 0;
  const api = await harness(t, async () => { if (++calls === 1) throw new TypeError('offline'); return json({ ok: true }); });
  assert.deepEqual(await Promise.all([api('student_workbook', args, 'token-a'), api('student_workbook', args, 'token-a')]), [{ ok: true }, { ok: true }]);
  assert.equal(calls, 2);
});

test('failed network requests are evicted, allowing a fresh manual retry', async t => {
  let calls = 0;
  const api = await harness(t, async () => { if (++calls <= 2) throw new TypeError('offline'); return json({ ok: true }); });
  const outcomes = await Promise.allSettled([api('student_workbook', args, 'token-a'), api('student_workbook', args, 'token-a')]);
  assert.ok(outcomes.every(result => result.status === 'rejected'));
  assert.equal(calls, 2);
  assert.deepEqual(await api('student_workbook', args, 'token-a'), { ok: true });
  assert.equal(calls, 3);
});

for (const status of [401, 500]) {
  test(`HTTP ${status} status/detail survive sharing and do not poison future reads`, async t => {
    let calls = 0;
    const api = await harness(t, async () => { calls++; return json({ error: 'expected', detail: { reason: 'fixture' } }, status); });
    const outcomes = await Promise.allSettled([api('student_workbook', args, 'token-a'), api('student_workbook', args, 'token-a')]);
    assert.equal(calls, 1);
    for (const result of outcomes) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason.status, status);
      assert.deepEqual(result.reason.detail, { reason: 'fixture' });
    }
    await assert.rejects(api('student_workbook', args, 'token-a'), error => error.status === status);
    assert.equal(calls, 2);
  });
}

for (const op of ['submit_workbook_attempts', 'set_workbook_bookmark', 'workbook_hint', 'student_review']) {
  test(`${op} is not coalesced`, async t => {
    const gate = deferred(); let calls = 0;
    const api = await harness(t, async () => { calls++; await gate.promise; return json({}); });
    const a = api(op, args, 'token-a'), b = api(op, args, 'token-a');
    assert.equal(calls, 2); gate.resolve(); await Promise.all([a, b]);
  });
}

test('an overridden body op cannot accidentally coalesce a write', async t => {
  const gate = deferred(); let calls = 0;
  const api = await harness(t, async () => { calls++; await gate.promise; return json({}); });
  const body = { ...args, op: 'set_workbook_bookmark' };
  const a = api('student_workbook', body, 'token-a'), b = api('student_workbook', body, 'token-a');
  assert.equal(calls, 2); gate.resolve(); await Promise.all([a, b]);
});

test('existing POST, authorization, payload and keepalive contract is preserved', async t => {
  let captured;
  const api = await harness(t, async (url, options) => { captured = { url, options }; return json({ ok: true }); });
  await api('student_workbook', args, 'token-a', { keepalive: true });
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.authorization, 'Bearer token-a');
  assert.equal(captured.options.keepalive, true);
  assert.deepEqual(JSON.parse(captured.options.body), { op: 'student_workbook', ...args });
});

test('missing API config keeps the original error and sends no request', async t => {
  let calls = 0;
  const api = await harness(t, async () => { calls++; return json({}); });
  window.READY_CONFIG = {};
  await assert.rejects(api('student_workbook', args, 'token-a'), /API_URL/);
  assert.equal(calls, 0);
});
