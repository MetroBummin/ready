// READY Admin: students, sentence sets, scope assignment, practice summary.
import { readyApi } from '../api.js';
import { practiceItems } from '../sentence-practice.js?v=sentence-practice-1';
import { matchEditorRows, parseSentenceRows } from './sentence-rows.js?v=sentence-practice-1';

const $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)];
const SESSION_KEY = 'ready-admin-session';
const SCOPE_SLOTS = [['중앙고', '1학년'], ['중앙고', '2학년'], ['동고', '1학년'], ['동고', '2학년'], ['신흥고', '1학년'], ['신흥고', '2학년'], ['한빛고', '1학년'], ['한빛고', '2학년'], ['test', '1학년'], ['test2', '2학년']];
const state = { token: '', data: null, route: 'students', period: '7d', progress: null, editor: null };
let busyCount = 0, toastTimer;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

function setBusy(on, label = '잠시만요…') { busyCount = Math.max(0, busyCount + (on ? 1 : -1)); $('#busy').hidden = !busyCount; $('#busy span:last-child').textContent = label; }
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('on'), 3200); }
function applyTheme(theme) { const dark = theme === 'dark'; document.documentElement.classList.toggle('dark', dark); document.body.classList.toggle('dark', dark); localStorage.setItem('ready-theme', theme); }
function clearSession() { localStorage.removeItem(SESSION_KEY); state.token = ''; state.data = null; }
async function call(op, data = {}, label = '잠시만요…') { setBusy(true, label); try { return await readyApi(op, data, state.token); } finally { setBusy(false); } }
async function safely(job, { auth = true } = {}) { try { return await job(); } catch (error) { if (auth && error.status === 401) { clearSession(); showLogin(); } toast(error.message || '요청을 처리하지 못했습니다.'); return null; } }
function showLogin() { $('#admin-login').hidden = false; $('#admin-nav').hidden = true; $('#admin-logout').hidden = true; $$('.view').forEach(view => view.classList.remove('on')); }
function route(name) {
  state.route = name;
  $$('.view').forEach(view => view.classList.toggle('on', view.id === `v-${name}`));
  $$('.navbtn').forEach(button => button.classList.toggle('on', button.dataset.route === name || (name === 'passage-editor' && button.dataset.route === 'passages')));
  if (name === 'students') renderStudents();
  if (name === 'passages') renderPassages();
  if (name === 'scopes') renderScopes();
}
async function login(form) {
  const password = new FormData(form).get('password'), data = await safely(() => call('admin_login', { password }, '확인하는 중…'), { auth: false });
  form.reset(); if (!data) return;
  state.token = data.session.token; localStorage.setItem(SESSION_KEY, JSON.stringify(data.session)); await loadAdmin();
}
async function loadAdmin() {
  const [data, progress] = await Promise.all([safely(() => call('teacher_bootstrap')), safely(() => readyApi('admin_learning_progress', { period: state.period }, state.token))]);
  if (!data) return;
  state.data = data; state.progress = progress;
  $('#admin-login').hidden = true; $('#admin-nav').hidden = false; $('#admin-logout').hidden = false;
  route(state.route === 'passage-editor' ? 'passages' : state.route);
}
async function logout() { if (state.token) readyApi('logout', {}, state.token).catch(() => {}); clearSession(); showLogin(); }

// ---------- Students ----------
function when(value) { if (!value) return '기록 없음'; const date = new Date(value); return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
function stepCell(step) { return step?.total ? `${step.clean}/${step.total}` : '0'; }
function renderStudents() {
  const students = state.data?.students || [], progress = new Map((state.progress?.students || []).map(item => [item.id, item]));
  $$('[data-learning-period]').forEach(button => button.classList.toggle('active', button.dataset.learningPeriod === state.period));
  $('#student-table').innerHTML = students.length ? `<div class="table-wrap"><table><thead><tr><th>이름</th><th>학교</th><th>학년</th><th>1단계 한 번에/완성</th><th>2단계 한 번에/완성</th><th>최근 연습</th><th></th></tr></thead><tbody>${students.map(student => { const item = progress.get(student.id); return `<tr><td>${esc(student.name)}</td><td>${esc(student.school)}</td><td>${esc(student.grade)}</td><td class="tabular">${stepCell(item?.steps?.[1])}</td><td class="tabular">${stepCell(item?.steps?.[2])}</td><td>${esc(when(item?.lastActivityAt))}</td><td><button class="text-button" type="button" data-student-code="${esc(student.id)}">코드 변경</button> <button class="text-button" type="button" data-delete-student="${esc(student.id)}">삭제</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">아직 학생이 없습니다.</div>';
}
async function createStudent(form) {
  const values = Object.fromEntries(new FormData(form)), data = await safely(() => call('create_student', values, '학생을 추가하는 중…'));
  if (!data) return; form.reset(); toast('학생을 추가했습니다.'); await loadAdmin();
}
async function changeStudentCode(studentId) {
  const code = prompt('새 학생 코드 (숫자 6자리)'); if (!code) return;
  if (await safely(() => call('set_student_code', { studentId, code }, '코드를 바꾸는 중…'))) toast('학생 코드를 바꿨습니다.');
}
async function confirmDelete(targetType, targetId) {
  const impact = await safely(() => call('delete_impact', { targetType, targetId }));
  if (!impact) return false;
  const counts = Object.entries(impact.counts).map(([key, value]) => `${({ attempts: '연습 기록', sentences: '문장', examLinks: '시험범위 연결' })[key] || key} ${value}개`).join(', ');
  return confirm(`"${impact.label}"을(를) 삭제합니다. 함께 삭제: ${counts}. 되돌릴 수 없습니다.`);
}
async function deleteStudent(studentId) {
  if (!(await confirmDelete('student', studentId))) return;
  if (await safely(() => call('delete_student', { studentId }, '삭제하는 중…'))) { toast('삭제했습니다.'); await loadAdmin(); }
}

// ---------- Sentence sets ----------
function renderPassages() {
  const passages = state.data?.passages || [];
  $('#passage-library').innerHTML = passages.length ? `<div class="table-wrap"><table><thead><tr><th>제목</th><th>학년</th><th>종류</th><th>수정</th></tr></thead><tbody>${passages.map(passage => `<tr><td><button class="text-button" type="button" data-open-passage="${esc(passage.id)}">${esc(passage.title)}</button></td><td>${esc(passage.grade)}</td><td>${passage.source_type === 'MOCK_EXAM' ? '모의고사' : '교과서'}</td><td>${esc(when(passage.updated_at))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">아직 문장 세트가 없습니다.</div>';
}
function fillPassageForm(passage = {}, rows = []) {
  const form = $('#passage-form');
  form.passageId.value = passage.id || ''; form.title.value = passage.title || ''; form.grade.value = passage.grade || '1학년';
  form.sourceType.value = passage.source_type || 'TEXTBOOK'; form.sourceYear.value = passage.source_year || ''; form.sourceMonth.value = passage.source_month || '';
  form.rows.value = rows.map(row => `${row.text}\t${row.translation}`).join('\n');
  $('[data-delete-passage]').hidden = !passage.id;
  $('#passage-page-title').textContent = passage.title || '새 문장 세트';
  route('passage-editor');
}
function newPassage() { state.editor = { rows: [] }; fillPassageForm(); }
async function openPassage(passageId) {
  const data = await safely(() => call('passage_editor', { passageId }, '문장을 불러오는 중…'));
  if (!data) return;
  state.editor = { rows: data.rows.filter(row => (row.blockType || 'SENTENCE') === 'SENTENCE') };
  fillPassageForm(data.passage, state.editor.rows);
}
async function savePassage(form) {
  const values = Object.fromEntries(new FormData(form)), parsed = parseSentenceRows(values.rows);
  if (parsed.errors.length) return toast(parsed.errors[0]);
  const skipped = parsed.rows.length - practiceItems(parsed.rows).length;
  const rows = matchEditorRows(state.editor?.rows || [], parsed.rows), body = { ...values, rows };
  const data = await safely(() => call(values.passageId ? 'save_passage' : 'create_passage', body, '저장하는 중…'));
  if (!data) return;
  toast(skipped ? `저장했습니다. 단어가 2개 미만인 ${skipped}문장은 배열 연습에서 제외됩니다.` : '저장했습니다.');
  await loadAdmin(); await openPassage(data.passageId);
}
async function deletePassage() {
  const passageId = $('#passage-form').passageId.value; if (!passageId || !(await confirmDelete('passage', passageId))) return;
  if (await safely(() => call('delete_passage', { passageId }, '삭제하는 중…'))) { toast('삭제했습니다.'); state.route = 'passages'; await loadAdmin(); }
}

// ---------- Scopes ----------
function renderScopes() {
  const exams = state.data?.exams || [], passages = state.data?.passages || [], links = state.data?.examPassages || [];
  $('#scope-list').innerHTML = SCOPE_SLOTS.map(([school, grade]) => {
    const exam = exams.find(item => item.school === school && item.grade === grade), assigned = new Set(links.filter(link => link.exam_id === exam?.id).map(link => link.passage_id)), candidates = passages.filter(passage => passage.grade === grade);
    return `<form class="card form-card scope-form" data-scope-school="${esc(school)}" data-scope-grade="${esc(grade)}"><h2>${esc(school)} · ${esc(grade)} <small>${assigned.size}개</small></h2>${candidates.length ? candidates.map(passage => `<label class="passage-check"><input type="checkbox" name="passageIds" value="${esc(passage.id)}" ${assigned.has(passage.id) ? 'checked' : ''}><span>${esc(passage.title)}</span></label>`).join('') : '<p class="empty">이 학년의 문장 세트가 없습니다.</p>'}<button class="button primary small" type="submit">저장</button></form>`;
  }).join('');
}
async function saveScope(form) {
  const passageIds = new FormData(form).getAll('passageIds');
  if (await safely(() => call('set_scope_passages', { school: form.dataset.scopeSchool, grade: form.dataset.scopeGrade, passageIds }, '시험범위를 저장하는 중…'))) { toast('시험범위를 저장했습니다.'); await loadAdmin(); }
}

document.addEventListener('click', async event => {
  const button = event.target.closest?.('button'); if (!button) return;
  if (button.id === 'theme-toggle') return applyTheme(document.body.classList.contains('dark') ? 'light' : 'dark');
  if (button.id === 'admin-logout') return logout();
  if (button.id === 'refresh-admin') return loadAdmin();
  if (button.dataset.route && state.token) return route(button.dataset.route);
  if (button.dataset.learningPeriod) { state.period = button.dataset.learningPeriod; state.progress = await safely(() => call('admin_learning_progress', { period: state.period })); return renderStudents(); }
  if (button.dataset.studentCode) return changeStudentCode(button.dataset.studentCode);
  if (button.dataset.deleteStudent) return deleteStudent(button.dataset.deleteStudent);
  if (button.hasAttribute('data-new-passage')) return newPassage();
  if (button.dataset.openPassage) return openPassage(button.dataset.openPassage);
  if (button.hasAttribute('data-delete-passage')) return deletePassage();
});
document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'admin-login-form') return login(form);
  if (form.id === 'create-student-form') return createStudent(form);
  if (form.id === 'passage-form') return savePassage(form);
  if (form.matches('[data-scope-school]')) return saveScope(form);
});

applyTheme(localStorage.getItem('ready-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
try { const previous = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); if (previous?.token) { state.token = previous.token; loadAdmin(); } else showLogin(); } catch { showLogin(); }
