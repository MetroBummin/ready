const getConfig = () => window.READY_CONFIG || {};
const READ_ONLY_OPS = new Set([
  'student_bootstrap_active', 'student_passage',
  'teacher_bootstrap', 'passage_editor', 'delete_impact', 'admin_learning_progress',
]);

// Without a deadline a stalled mobile connection leaves the request (and the
// attempt queue waiting on it) pending until the page is reloaded.
const REQUEST_TIMEOUT_MS = 30_000;
function deadline(signal, ms) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ms);
  const forward = () => controller.abort();
  signal?.addEventListener?.('abort', forward, { once: true });
  return { signal: controller.signal, done: () => { clearTimeout(timer); signal?.removeEventListener?.('abort', forward); } };
}

export async function readyApi(op, data = {}, token = '', { signal, keepalive = false, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const { API_URL } = getConfig();
  if (!API_URL) throw new Error('READY config.js의 API_URL을 확인해 주세요.');
  let response;
  const attempts = READ_ONLY_OPS.has(op) ? 2 : 1;
  for (let attempt=0; attempt<attempts && !response; attempt+=1) {
    const limit = deadline(signal, timeout);
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: limit.signal,
        keepalive,
        body: JSON.stringify({ op, ...data }),
      });
    } catch {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt === attempts - 1) throw new Error('READY 서버에 연결할 수 없습니다. 배포 상태와 네트워크를 확인해 주세요.');
      await new Promise(resolve => setTimeout(resolve, 350));
    } finally { limit.done(); }
  }
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    const error = new Error(body.error || `READY 서버 오류 (${response.status})`);
    error.status = response.status;
    error.detail = body.detail;
    throw error;
  }
  return body;
}


// Idempotency key for one finished sentence. crypto.randomUUID needs a secure
// context and Safari 15.4+ / Chrome 92+; older WebViews only have
// getRandomValues, so build the same RFC 4122 v4 shape from it.
export function attemptId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === 'function') return cryptoImpl.randomUUID();
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
