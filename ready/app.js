// READY Student: sentence-ordering practice (step 1 and step 2) only.
import { attemptId, readyApi } from './api.js';
import { attemptPayload, builtSentence, LONG_SENTENCE_WORD_THRESHOLD, placeWord, practiceItems, runIsClean, startRun, stepUsesAudio, visibleChips } from './sentence-practice.js?v=sentence-practice-1';
import { sentenceAudioSupported, speakSentence, stopSentenceAudio } from './sentence-audio.js?v=sentence-practice-1';
import { clearWorkbookCycleItem } from './workbook-progress.js?v=sentence-practice-1';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const SESSION_KEY = 'ready-student-session';
const ATTEMPT_QUEUE = 'ready-sentence-attempt-queue-v1:';
// Disposable caches of the removed Reader/Workbook/Review client. Some held
// whole Workbook catalogs and could fill the storage quota the attempt queue
// needs. The old unsent Workbook attempt queue is left untouched.
const LEGACY_CACHE_PREFIXES = ['ready-dashboard-cache-v1:', 'ready-passage-cache-v2:', 'ready-review-cache-v3:', 'ready-workbook-cache-v3:', 'ready-workbook-progress-floor-v2:', 'ready-last-passage:'];
const MAX_FLUSH_DELAY = 60_000, TAP_SETTLE_MS = 280;
const STEP_LABEL = { 1: '1단계 · 듣고 배열', 2: '2단계 · 혼자 배열' };
const state = { token: '', student: null, scope: null, passages: [], practice: null };
let busyCount = 0, toastTimer, flushTimer = null, attemptQueue = [], flushing = null, wrongTimer = null, flushDelay = 1500;
const passageCache = new Map();

function busy(on, label = '잠시만요…') { busyCount = Math.max(0, busyCount + (on ? 1 : -1)); $('#busy').hidden = !busyCount; $('#busy span:last-child').textContent = label; }
function toast(message, ms = 2400) { const node = $('#toast'); node.textContent = message; node.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('on'), ms); }
function theme(next) { const dark = next === 'dark'; document.documentElement.classList.toggle('dark', dark); document.body.classList.toggle('dark', dark); localStorage.setItem('ready-theme', next); }
async function call(op, data = {}, label = '잠시만요…') { busy(true, label); try { return await readyApi(op, data, state.token); } finally { busy(false); } }
function announce(message) { const node = $('#practice-live'); if (!node) return; node.textContent = ''; if (message) setTimeout(() => { node.textContent = message; }, 30); }
function clearLegacyCaches() {
  try { for (let index = localStorage.length - 1; index >= 0; index -= 1) { const key = localStorage.key(index); if (key && LEGACY_CACHE_PREFIXES.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key); } } catch { /* storage disabled */ }
}
async function safely(job, { auth = true } = {}) {
  try { return await job(); } catch (error) {
    if (auth && error.status === 401) { clearSession(); showLogin(); }
    toast(error.message || '요청을 처리하지 못했습니다.', 3600);
    return null;
  }
}
function show(id) {
  ['student-home', 'student-sets', 'student-workbook'].forEach(section => { $('#' + section).hidden = section !== id; });
  document.body.classList.toggle('study-mode', id === 'student-workbook');
  $('#logout').hidden = !state.token;
}
// The queue stays in localStorage under the student id, so attempts survive
// an expired session and are sent after the same student logs in again.
function clearSession() {
  clearTimeout(flushTimer); flushTimer = null; attemptQueue = []; flushing = null; flushDelay = 1500; stopSentenceAudio(); passageCache.clear();
  localStorage.removeItem(SESSION_KEY);
  Object.assign(state, { token: '', student: null, scope: null, passages: [], practice: null });
}
function showLogin() { show('student-home'); requestAnimationFrame(() => $('#student-code')?.focus()); }

async function login(form) {
  const code = new FormData(form).get('code');
  const data = await safely(() => call('student_login', { code, remember: true }, '학생 코드를 확인하는 중…'), { auth: false });
  form.reset(); $('#student-code').blur();
  if (!data) return;
  state.token = data.session.token; state.student = data.student;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...data.session, studentId: data.student.id }));
  await loadHome();
}
async function logout() { if (state.token) { await flushAttempts(); readyApi('logout', {}, state.token).catch(() => {}); } clearSession(); showLogin(); }

// ---------- Home: assigned sentence sets ----------
function stepProgress(passage, step) { return passage?.progress?.[step] || { total: passage?.sentenceCount || 0, completedCycles: 0, currentCycle: 1, currentCycleClears: [] }; }
function progressLabel(progress) {
  const cleared = progress.currentCycleClears?.length || 0, total = Number(progress.total) || 0, cycles = Number(progress.completedCycles) || 0;
  return `${cleared}/${total}${cycles ? ` · ${cycles}회 완료` : ''}`;
}
function passageRow(passage, index) {
  const steps = [1, 2].map(step => `<button class="passage-workbook" type="button" data-start-step="${step}" data-passage="${esc(passage.id)}" aria-label="${esc(passage.title)} ${step}단계 시작">${step}단계 <small>${esc(progressLabel(stepProgress(passage, step)))}</small></button>`).join('');
  return `<article class="passage-row"><button class="passage-open" type="button" data-start-step="1" data-passage="${esc(passage.id)}"><span class="passage-index">${String(index + 1).padStart(2, '0')}</span><span class="passage-copy"><strong>${esc(passage.title)}</strong><small>문장 ${Number(passage.sentenceCount) || 0}개</small></span></button><div class="passage-actions">${steps}</div></article>`;
}
function renderHome() {
  state.practice = null; stopSentenceAudio(); show('student-sets');
  const content = !state.scope ? '<div class="empty scope-empty"><strong>아직 배정된 시험범위가 없습니다.</strong></div>'
    : state.passages.length ? `<div class="passage-list">${state.passages.map(passageRow).join('')}</div>`
      : '<div class="empty scope-empty"><strong>아직 배정된 문장 세트가 없습니다.</strong></div>';
  $('#student-sets').innerHTML = `<div class="home-head"><span>문장 배열 연습</span><small>${state.scope ? `${esc(state.student?.school)} · ${esc(state.student?.grade)} · ${state.passages.length}개` : ''}</small></div><p class="practice-home-lead">1단계는 소리를 들으며 배열하고, 틀려도 계속 진행합니다. 2단계는 소리 없이 배열하며 틀리면 처음부터 다시 시작합니다. ${LONG_SENTENCE_WORD_THRESHOLD}단어 이상 문장은 한 번까지 틀려도 됩니다.</p><div class="home-content">${content}</div>`;
}
function renderOffline() {
  show('student-sets');
  $('#student-sets').innerHTML = '<div class="empty scope-empty"><strong>READY 서버에 연결할 수 없습니다.</strong><p>네트워크를 확인한 뒤 다시 시도해 주세요. 완성한 문장 기록은 이 기기에 보관되어 있습니다.</p><button class="button primary" type="button" data-retry-home>다시 시도</button></div>';
  $('[data-retry-home]')?.focus({ preventScroll: true });
}
async function loadHome() {
  restoreAttempts();
  let failed = false;
  const data = await safely(async () => { try { return await call('student_bootstrap_active', {}, '학습 범위를 준비하는 중…'); } catch (error) { failed = error.status !== 401; throw error; } });
  // Offline or server error: keep the session instead of showing the code form.
  if (!data) { if (failed && state.token) renderOffline(); return; }
  Object.assign(state, { student: data.student, scope: data.scope, passages: data.passages || [] });
  restoreAttempts();
  renderHome();
  flushAttempts();
}

// ---------- Practice ----------
function current() { const practice = state.practice; return { practice, item: practice?.items[practice.index] }; }
async function loadPassage(passageId) {
  try {
    const data = await call('student_passage', { examId: state.scope.id, passageId }, '문장을 불러오는 중…');
    passageCache.set(passageId, data); return data;
  } catch (error) {
    // A set opened earlier in this session can be practised offline; attempts queue up.
    if (!error.status && passageCache.has(passageId)) { toast('오프라인입니다. 이미 불러온 문장으로 연습합니다.'); return passageCache.get(passageId); }
    throw error;
  }
}
async function openPractice(passageId, step) {
  if (!state.scope) return;
  const data = await safely(() => loadPassage(passageId));
  if (!data) return;
  const items = practiceItems(data.sentences);
  if (!items.length) return toast('배열할 문장이 없습니다.');
  const passage = state.passages.find(candidate => candidate.id === passageId);
  if (passage && data.progress) passage.progress = data.progress;
  const cleared = new Set(stepProgress(passage || data, step).currentCycleClears || []), firstOpen = items.findIndex(item => !cleared.has(item.key));
  state.practice = { passageId, title: data.passage?.title || passage?.title || '', step: Number(step), items, index: Math.max(0, firstOpen), run: null, orders: {}, feedback: null, cleanCount: 0, finishedCount: 0, done: false, settleUntil: 0 };
  startItem({ focus: true });
}
function startItem({ focus = false } = {}) {
  const { practice, item } = current();
  if (!practice || !item) return;
  practice.run = startRun(item, practice.step); practice.orders = {}; practice.feedback = null; practice.settleUntil = 0;
  stopSentenceAudio();
  renderPractice({ focusChip: focus });
}
function feedbackHtml(practice, item) {
  const feedback = practice.feedback, run = practice.run;
  if (run.completed) {
    const clean = runIsClean(run);
    return `<div class="workbook-feedback ${clean ? 'correct' : 'wrong'}"><strong>${clean ? '완성했어요.' : '끝까지 완성했어요.'}</strong><span class="workbook-feedback-copy"><span lang="en">${esc(item.text)}</span>${clean ? '' : `<span>${practice.step === 1 ? `틀린 선택 ${run.mistakes}번` : `다시 시작 ${run.restarts}번`} · 다음에는 한 번에 해 보세요.</span>`}</span></div><div class="workbook-actions"><button class="button primary" type="button" data-practice-next>${practice.index === practice.items.length - 1 ? '결과 보기' : '다음 문장'}</button></div>`;
  }
  if (feedback?.type === 'mistake' && practice.step === 1) return `<small class="practice-note">그 단어는 아직 아니에요. 계속 골라 보세요.</small>`;
  if (feedback?.type === 'mistake') return `<small class="workbook-order-feedback">한 번 틀렸어요. 한 번 더 틀리면 처음부터 다시 시작해요.</small>`;
  if (feedback?.type === 'restart') return `<small class="workbook-order-feedback">틀렸어요. 처음부터 다시 배열하세요.</small>`;
  return '';
}
function orderGroupHtml(practice, item) {
  const run = practice.run, built = builtSentence(item, run), { visible } = visibleChips(item, run, practice.orders), used = new Set(run.consumed), wrong = practice.feedback?.wrongChip;
  const bank = run.completed ? '' : visible.map(chip => `<span class="workbook-order-bank-slot${used.has(chip) ? ' used' : ''}${wrong === chip ? ' wrong' : ''}"><button type="button" data-chip="${chip}" aria-invalid="${wrong === chip}" ${used.has(chip) ? 'disabled' : ''}>${esc(item.words[chip])}</button></span>`).join('');
  return `<span class="workbook-order-group${run.completed ? ' correct' : ''}" data-practice-group><span class="workbook-order-built" role="group" aria-label="배열한 문장"><span class="workbook-order-built-sizer" aria-hidden="true">${esc(item.answer)}</span><span class="workbook-order-built-text">${built ? esc(built) : '<em>단어를 순서대로 누르세요</em>'}</span></span><span class="workbook-order-bank" aria-label="선택할 단어">${bank}</span></span>`;
}
// Every tap re-renders the card, which would drop keyboard and screen-reader
// focus on <body>. Focus moves to the same chip (or the first open one).
function renderPractice({ focusChip = false } = {}) {
  const { practice, item } = current();
  if (!practice) return renderHome();
  if (practice.done) return renderSummary();
  const active = document.activeElement, chipFocused = Boolean(active?.closest?.('#student-workbook') && active.dataset?.chip !== undefined);
  const previousChip = chipFocused ? active.dataset.chip : null;
  show('student-workbook');
  const run = practice.run, audio = stepUsesAudio(practice.step) && sentenceAudioSupported() ? '<button class="button quiet practice-audio" type="button" data-play-audio aria-label="영어 문장 듣기">▶ 문장 듣기</button>' : '';
  const tolerance = practice.step === 2 ? `<span class="practice-rule">${run.allowance ? '한 번 틀려도 됨' : '틀리면 다시 시작'}</span>` : '';
  $('#student-workbook').innerHTML = `<button class="study-back" type="button" data-exit-practice aria-label="목록으로"><span aria-hidden="true">‹</span></button><div class="workbook-study-layout"><header class="workbook-study-head workbook-study-toolbar"><span class="workbook-state"><b>${practice.index + 1} / ${practice.items.length}</b><span class="practice-step-meta"><span class="workbook-order-mode" data-practice-step="${practice.step}">${STEP_LABEL[practice.step]}</span>${tolerance}</span></span></header><section class="workbook-card workbook-focus-card" data-practice-item="${esc(item.key)}"><blockquote lang="ko">${esc(item.translation)}</blockquote>${audio}<div class="workbook-prompt order-task" lang="en">${orderGroupHtml(practice, item)}</div><div data-practice-outcome>${feedbackHtml(practice, item)}</div></section></div>`;
  if (run.completed) $('[data-practice-next]')?.focus({ preventScroll: true });
  else if (chipFocused || focusChip) ($(`[data-chip="${previousChip}"]:not([disabled])`) || $('[data-chip]:not([disabled])'))?.focus({ preventScroll: true });
}
const FEEDBACK_SPEECH = { 1: { mistake: '그 단어는 아직 아니에요.' }, 2: { mistake: '한 번 틀렸어요. 한 번 더 틀리면 처음부터 다시 시작해요.', restart: '틀렸어요. 처음부터 다시 배열하세요.' } };
function tapChip(chipIndex) {
  const { practice, item } = current();
  if (!practice || !item || practice.run.completed) return;
  // When a batch is replaced (or the sentence restarts) new chips appear under
  // the finger; ignore a fast second tap so it is not counted as a mistake.
  if (performance.now() < practice.settleUntil) return;
  const before = visibleChips(item, practice.run, practice.orders).batchIndex;
  const result = placeWord(item, practice.run, chipIndex);
  if (result.type === 'ignore') return;
  practice.run = result.run;
  if (result.type === 'restart') practice.orders = {};
  practice.feedback = result.type === 'mistake' || result.type === 'restart' ? { type: result.type, wrongChip: result.type === 'mistake' ? chipIndex : null } : null;
  if (result.type === 'complete') finishItem(practice, item);
  else if (result.type === 'restart' || visibleChips(item, practice.run, practice.orders).batchIndex !== before) practice.settleUntil = performance.now() + TAP_SETTLE_MS;
  renderPractice();
  announce(result.type === 'complete' ? `완성했어요. ${item.text}` : FEEDBACK_SPEECH[practice.step]?.[result.type] || '');
  clearTimeout(wrongTimer);
  if (result.type === 'mistake') wrongTimer = setTimeout(() => { if (state.practice === practice && practice.feedback?.wrongChip === chipIndex) { practice.feedback = { ...practice.feedback, wrongChip: null }; renderPractice(); } }, 650);
}
function finishItem(practice, item) {
  const clean = runIsClean(practice.run);
  practice.finishedCount += 1; if (clean) practice.cleanCount += 1;
  const passage = state.passages.find(candidate => candidate.id === practice.passageId);
  if (clean && passage) { const progress = stepProgress(passage, practice.step); passage.progress = { ...(passage.progress || {}), [practice.step]: { ...progress, ...clearWorkbookCycleItem(progress, item.key, progress.total) } }; }
  queueAttempt({ examId: state.scope.id, passageId: practice.passageId, ...attemptPayload(item, practice.run), clientAttemptId: attemptId() });
}
function nextItem() {
  const { practice } = current();
  if (!practice?.run?.completed) return;
  if (practice.index >= practice.items.length - 1) { practice.done = true; stopSentenceAudio(); return renderSummary(); }
  practice.index += 1; startItem({ focus: true });
}
function renderSummary() {
  const practice = state.practice; show('student-workbook');
  const nextStep = practice.step === 1 ? '<button class="button quiet" type="button" data-practice-step2>2단계 시작</button>' : '';
  $('#student-workbook').innerHTML = `<button class="study-back" type="button" data-exit-practice aria-label="목록으로"><span aria-hidden="true">‹</span></button><div class="workbook-milestone-shell"><section class="workbook-milestone" aria-live="polite"><div class="workbook-milestone-mark"><span>${practice.cleanCount}/${practice.finishedCount}</span></div><p class="eyebrow">${esc(STEP_LABEL[practice.step])}</p><h1>${esc(practice.title)}</h1><p>${practice.finishedCount}문장을 완성했고, 그중 ${practice.cleanCount}문장은 한 번에 맞혔어요.</p><div class="workbook-milestone-actions"><button class="button primary" type="button" data-practice-repeat>다시 하기</button>${nextStep}<button class="button quiet" type="button" data-exit-practice>목록으로</button></div></section></div>`;
}
function restartSet(step) {
  const practice = state.practice; if (!practice) return;
  Object.assign(practice, { step, index: 0, done: false, cleanCount: 0, finishedCount: 0 });
  startItem({ focus: true });
}

// ---------- Attempt queue (local-first, flushed in batches) ----------
// Keyed by student id so a queue written under an expired token is still sent
// after the same student logs in again. `legacyQueueKey` is the former
// token-suffix key; its entries are merged once and the key removed.
function queueKey() { return state.student?.id ? `${ATTEMPT_QUEUE}student:${state.student.id}` : ''; }
function legacyQueueKey() { return state.token ? `${ATTEMPT_QUEUE}${state.token.slice(-12)}` : ''; }
function saveQueue(key = queueKey()) { if (!key) return; try { if (attemptQueue.length) localStorage.setItem(key, JSON.stringify(attemptQueue)); else localStorage.removeItem(key); } catch { /* storage full or disabled */ } }
function readQueue(key) { try { const saved = key ? JSON.parse(localStorage.getItem(key) || '[]') : []; return Array.isArray(saved) ? saved.filter(entry => entry && typeof entry === 'object') : []; } catch { return []; } }
function restoreAttempts() {
  const key = queueKey(); if (!key) return;
  const known = new Set(attemptQueue.map(entry => entry.clientAttemptId)), legacy = legacyQueueKey();
  for (const entry of [...readQueue(key), ...readQueue(legacy)]) if (!known.has(entry.clientAttemptId)) { known.add(entry.clientAttemptId); attemptQueue.push(entry); }
  saveQueue(key);
  if (legacy) try { localStorage.removeItem(legacy); } catch { /* storage disabled */ }
}
function queueAttempt(body) { attemptQueue.push(body); saveQueue(); clearTimeout(flushTimer); flushTimer = setTimeout(() => flushAttempts(), 300); }
function scheduleFlush(delay) { clearTimeout(flushTimer); flushTimer = setTimeout(() => flushAttempts(), delay); }
async function flushAttempts({ keepalive = false } = {}) {
  clearTimeout(flushTimer); flushTimer = null;
  if (flushing) return flushing;
  if (!attemptQueue.length || !state.token || !state.student?.id) return;
  const token = state.token, key = queueKey(), batch = attemptQueue.slice(0, 20);
  let failed = false;
  flushing = (async () => {
    try {
      const data = await readyApi('submit_sentence_attempts', { attempts: batch }, token, { keepalive });
      batch.forEach((entry, index) => {
        const result = data.results?.[index];
        // Rejected attempts would be rejected again on retry, so they are dropped too.
        if (result?.attempt?.id || result?.rejected) attemptQueue = attemptQueue.filter(candidate => candidate !== entry);
        else failed = true;
        const passage = state.passages.find(candidate => candidate.id === entry.passageId);
        if (result?.progress && passage) passage.progress = { ...(passage.progress || {}), [entry.step]: result.progress };
      });
    } catch (error) {
      failed = true;
      if (error.status === 401 && state.token === token) { saveQueue(key); clearSession(); showLogin(); toast('다시 로그인하면 완성한 문장 기록을 이어서 저장합니다.', 3600); }
    } finally {
      if (state.token === token) saveQueue(key);
      flushing = null;
      // Exponential backoff while offline or while the server keeps failing.
      flushDelay = failed ? Math.min(MAX_FLUSH_DELAY, flushDelay * 2) : 1500;
      if (state.token === token && attemptQueue.length && !keepalive) scheduleFlush(failed ? flushDelay : 300);
    }
  })();
  return flushing;
}

// ---------- Events ----------
document.addEventListener('click', event => {
  const button = event.target.closest?.('button');
  if (!button) return;
  if (button.id === 'theme-toggle') return theme(document.body.classList.contains('dark') ? 'light' : 'dark');
  if (button.id === 'logout') return logout();
  if (button.hasAttribute('data-home') && state.token) return state.scope || state.passages.length ? renderHome() : loadHome();
  if (button.hasAttribute('data-retry-home')) return loadHome();
  if (button.dataset.startStep) return openPractice(button.dataset.passage, Number(button.dataset.startStep));
  if (button.dataset.chip !== undefined) return tapChip(Number(button.dataset.chip));
  if (button.hasAttribute('data-play-audio')) { const { item } = current(); if (item) speakSentence(item.text); return; }
  if (button.hasAttribute('data-practice-next')) return nextItem();
  if (button.hasAttribute('data-practice-repeat')) return restartSet(state.practice.step);
  if (button.hasAttribute('data-practice-step2')) return restartSet(2);
  if (button.hasAttribute('data-exit-practice')) { const passageId = state.practice?.passageId || ''; flushAttempts(); renderHome(); return $(`.passage-open[data-passage="${CSS.escape(passageId)}"]`)?.focus({ preventScroll: true }); }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || $('#student-workbook').hidden || event.isComposing) return;
  const { practice } = current();
  if (practice?.run?.completed && !practice.done) { event.preventDefault(); nextItem(); }
});
document.addEventListener('submit', event => { event.preventDefault(); if (event.target.id === 'student-code-form') login(event.target); });
window.addEventListener('pagehide', () => { stopSentenceAudio(); flushAttempts({ keepalive: true }); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { stopSentenceAudio(); flushAttempts({ keepalive: true }); } });
window.addEventListener('online', () => { flushDelay = 1500; flushAttempts(); });

theme(localStorage.getItem('ready-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
clearLegacyCaches();
try { const previous = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); if (previous?.token) { state.token = previous.token; if (previous.studentId) state.student = { id: previous.studentId }; loadHome(); } else showLogin(); } catch { showLogin(); }
