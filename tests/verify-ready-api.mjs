// API integration test: the READY Edge Function against an in-memory
// PostgreSQL (PGlite) built from supabase/migrations. No network, no secrets.
import assert from 'node:assert/strict';
import { admin, call, close, pg, READY_OPS, request } from './helpers/ready-api.mjs';

const EXPECTED_OPS = ['student_login', 'admin_login', 'logout', 'student_bootstrap_active', 'student_passage', 'submit_sentence_attempts', 'teacher_bootstrap', 'create_student', 'set_student_code', 'delete_student', 'create_passage', 'passage_editor', 'save_passage', 'delete_passage', 'delete_impact', 'set_scope_passages', 'admin_learning_progress'];
const uuid = () => crypto.randomUUID();
try {
  assert.deepEqual([...READY_OPS].sort(), [...EXPECTED_OPS].sort(), 'the server exposes only the sentence-practice endpoints');
  for (const removed of ['student_workbook', 'submit_workbook_attempt', 'student_questions', 'submit_attempt', 'word_lookup_meaning', 'sentence_easy_translation', 'studio_publisher_import', 'factory_start', 'student_review_export_active', 'import_questions']) {
    const response = await request(removed, {}, admin);
    assert.equal(response.status, 404, `${removed} is removed`);
  }
  assert.equal((await request('teacher_bootstrap', {})).status, 401, 'admin endpoints need an admin session');

  // Admin: student, sentence set, scope.
  const { student } = await call('create_student', { name: '연습 학생', school: '중앙고', grade: '1학년', code: '246810' }, admin);
  const rows = [
    { text: 'The boy ate an apple in the park.', translation: '소년은 공원에서 사과를 먹었다.' },
    { text: 'My sister and I walked to a small library near the river on a rainy day.', translation: '언니와 나는 비 오는 날 강 근처의 작은 도서관까지 걸었다.' },
    { text: 'Wow!', translation: '와!' },
  ];
  const { passageId } = await call('create_passage', { title: 'Lesson 1 문장', grade: '1학년', sourceType: 'TEXTBOOK', rows }, admin);
  await call('set_scope_passages', { school: '중앙고', grade: '1학년', passageIds: [passageId] }, admin);
  const bootstrap = await call('teacher_bootstrap', {}, admin);
  const scope = bootstrap.exams.find(exam => exam.school === '중앙고' && exam.grade === '1학년');
  assert.ok(bootstrap.examPassages.some(link => link.exam_id === scope.id && link.passage_id === passageId));

  // Student login and home.
  await assert.rejects(() => call('student_login', { code: '000000' }), /학생 코드/);
  const login = await call('student_login', { code: '246810', remember: true }), token = login.session.token;
  assert.equal(login.student.id, student.id);
  assert.equal((await request('teacher_bootstrap', {}, token)).status, 401, 'students cannot call admin endpoints');
  const home = await call('student_bootstrap_active', {}, token);
  assert.equal(home.scope.id, scope.id);
  assert.equal(home.passages.length, 1);
  assert.equal(home.passages[0].sentenceCount, 2, 'one-word rows are not practice items');
  assert.deepEqual(home.passages[0].progress[1], { total: 2, correctClears: 0, completedCycles: 0, currentCycle: 1, currentCycleClears: [], progressPercent: 0 });

  const passage = await call('student_passage', { examId: scope.id, passageId }, token);
  assert.equal(passage.sentences.length, 3);
  assert.ok(passage.sentences.every(row => row.translation), 'Korean translations are delivered');
  const [short, long] = passage.sentences;

  // Attempts: step 1 with mistakes (continues, not clean), step 2 clean, step 2 long with one tolerated mistake.
  const attempt = (sentence, step, extra = {}) => ({ examId: scope.id, passageId, sentenceId: sentence.id, step, arranged: sentence.text.replace(/[.!?,]/g, ''), mistakes: 0, restarts: 0, clientAttemptId: uuid(), ...extra });
  const first = attempt(short, 1, { mistakes: 2 });
  let saved = await call('submit_sentence_attempts', { attempts: [first, attempt(short, 2), attempt(long, 2, { mistakes: 1 }), attempt(long, 2, { mistakes: 1, restarts: 1, arranged: 'boy ate apple' }), attempt(short, 2, { mistakes: 1 })] }, token);
  assert.equal(saved.results[0].correct, false, 'step 1 with mistakes is completed but not clean');
  assert.equal(saved.results[1].correct, true);
  assert.equal(saved.results[2].correct, true, '12+ words: one mistake in step 2 is tolerated');
  assert.equal(saved.results[3].rejected, true, 'an incomplete arrangement is rejected');
  assert.equal(saved.results[4].rejected, true, 'a short step-2 sentence cannot finish with a tolerated mistake');
  assert.deepEqual(saved.results[2].progress.currentCycleClears, [], 'clearing both sentences completes the step-2 cycle');
  assert.equal(saved.results[2].progress.completedCycles, 1);

  saved = await call('submit_sentence_attempts', { attempts: [first] }, token);
  assert.equal((await pg.query("select count(*)::integer as count from ready_workbook_attempts where client_attempt_id=$1", [first.clientAttemptId])).rows[0].count, 1, 'a retried attempt is stored once');
  const stored = (await pg.query("select workbook_key,item_key,stage,stage_contract_version,semantic_type,correct,response from ready_workbook_attempts where student_id=$1 order by created_at", [student.id])).rows;
  assert.equal(stored.length, 3);
  assert.deepEqual(stored.map(row => [row.workbook_key, row.stage, row.semantic_type, row.stage_contract_version]), [['sentence-practice', 1, 'sentence_order_step1', 'sentence-practice-v1'], ['sentence-practice', 2, 'sentence_order_step2', 'sentence-practice-v1'], ['sentence-practice', 2, 'sentence_order_step2', 'sentence-practice-v1']]);
  assert.equal(stored[0].item_key, `sentence:${short.id}`);
  assert.equal(stored[0].response.mistakes, 2);
  await assert.rejects(() => pg.query('update ready_workbook_attempts set correct=true'), /append-only/, 'attempts stay append-only');

  const after = await call('student_bootstrap_active', {}, token);
  assert.deepEqual(after.passages[0].progress[1].currentCycleClears, [], 'an unclean step-1 run does not advance progress');
  assert.equal(after.passages[0].progress[2].completedCycles, 1);
  assert.equal(after.passages[0].progress[2].progressPercent, 100);

  // Admin summary and editing keep sentence ids.
  const progress = await call('admin_learning_progress', { period: '7d' }, admin), row = progress.students.find(item => item.id === student.id);
  assert.deepEqual(row.steps, { 1: { total: 1, clean: 0 }, 2: { total: 2, clean: 2 } });
  const editor = await call('passage_editor', { passageId }, admin);
  await call('save_passage', { passageId, title: 'Lesson 1 문장', grade: '1학년', sourceType: 'TEXTBOOK', rows: [{ ...editor.rows[0], translation: '소년이 공원에서 사과를 먹었다.' }, editor.rows[1]] }, admin);
  const edited = await call('student_passage', { examId: scope.id, passageId }, token);
  assert.deepEqual(edited.sentences.map(sentence => sentence.id), [short.id, long.id], 'edited sentences keep their ids; removed rows become inactive');
  assert.equal(edited.sentences[0].translation, '소년이 공원에서 사과를 먹었다.');

  // Access control and deletion.
  const other = (await call('create_passage', { title: '배정 안 됨', grade: '1학년', rows }, admin)).passageId;
  await call('set_scope_passages', { school: '중앙고', grade: '1학년', passageIds: [passageId] }, admin);
  await assert.rejects(() => call('student_passage', { examId: scope.id, passageId: other }, token), /시험범위/);
  const impact = await call('delete_impact', { targetType: 'student', targetId: student.id }, admin);
  assert.deepEqual(impact.counts, { attempts: 3 });
  await call('delete_student', { studentId: student.id }, admin);
  assert.equal((await request('student_bootstrap_active', {}, token)).status, 401);
  await call('delete_passage', { passageId: other }, admin);
  await call('logout', {}, admin);
  assert.equal((await request('teacher_bootstrap', {}, admin)).status, 401);
  console.log('READY sentence-practice API integration (PGlite) passed.');
} finally {
  await close();
}
