// API integration test: the READY Edge Function against an in-memory
// PostgreSQL (PGlite) built from supabase/migrations. No network, no secrets.
import assert from 'node:assert/strict';
import { admin, call, close, learningSince, mergePassageStructure, pg, READY_OPS, request } from './helpers/ready-api.mjs';

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

  // A batch whose sentence was removed meanwhile: the removed one is rejected
  // (dropped by the client), not a retry-forever error; a stored attempt is
  // replayed even after its sentence is gone.
  const queuedForRemoved = attempt(long, 1);
  saved = await call('submit_sentence_attempts', { attempts: [queuedForRemoved] }, token);
  assert.ok(saved.results[0].attempt.id);
  const editorNow = await call('passage_editor', { passageId }, admin);
  await call('save_passage', { passageId, title: 'Lesson 1 문장', grade: '1학년', sourceType: 'TEXTBOOK', rows: [editorNow.rows[0]], expectedRevision: editorNow.passage.canonical_revision }, admin);
  saved = await call('submit_sentence_attempts', { attempts: [attempt(long, 2), queuedForRemoved, attempt(short, 1), attempt(short, 1, { clientAttemptId: undefined })] }, token);
  assert.equal(saved.results[0].rejected, true, 'an attempt for a removed sentence is rejected, not retried forever');
  assert.equal(saved.results[0].error, undefined);
  assert.equal(saved.results[1].attempt.id, (await pg.query('select id from ready_workbook_attempts where client_attempt_id=$1', [queuedForRemoved.clientAttemptId])).rows[0].id, 'a stored attempt is replayed even after its sentence was removed');
  assert.equal(saved.results[1].replayed, true);
  assert.ok(saved.results[2].attempt.id);
  assert.equal(saved.results[2].progress.total, 1, 'progress counts only the active sentences');
  assert.deepEqual([saved.results[2].progress.completedCycles, saved.results[2].progress.currentCycleClears], [1, []], 'one active sentence left: clearing it closes the step-1 cycle');
  assert.equal(saved.results[3].rejected, true, 'an attempt without clientAttemptId is rejected');
  const removedHome = await call('student_bootstrap_active', {}, token);
  assert.equal(removedHome.passages[0].sentenceCount, 1);
  assert.ok(removedHome.passages[0].progress[2].currentCycleClears.every(key => key === `sentence:${short.id}`), 'clears of removed sentences are not reported');

  // Optimistic concurrency: a save based on an older revision is refused.
  const stale = await call('passage_editor', { passageId }, admin);
  await call('save_passage', { passageId, title: 'Lesson 1 문장', grade: '1학년', sourceType: 'TEXTBOOK', rows: [...stale.rows, { text: 'Admin A added this line.', translation: 'A가 추가했다.' }], expectedRevision: stale.passage.canonical_revision }, admin);
  const conflict = await request('save_passage', { passageId, title: 'Lesson 1 문장', grade: '1학년', sourceType: 'TEXTBOOK', rows: [...stale.rows, { text: 'Admin B added another line.', translation: 'B가 추가했다.' }], expectedRevision: stale.passage.canonical_revision }, admin);
  assert.equal(conflict.status, 409, 'a stale save gets a conflict');
  assert.match((await conflict.json()).error, /다른 곳에서/);
  assert.deepEqual((await call('passage_editor', { passageId }, admin)).rows.map(row => row.text), ['The boy ate an apple in the park.', 'Admin A added this line.'], 'the first save is not lost');

  // Legacy sets keep TITLE/SUBTITLE rows and paragraphs when saved from the sentence-only editor.
  const legacyId = (await call('create_passage', { title: 'Legacy', grade: '1학년', rows: [{ text: 'First line here.', translation: '첫째' }, { text: 'Second line here.', translation: '둘째' }, { text: 'Third line here.', translation: '셋째' }] }, admin)).passageId;
  const legacyRows = (await pg.query('select id from ready_passage_sentences where passage_id=$1 order by sentence_index', [legacyId])).rows.map(row => row.id);
  await pg.query("update ready_passage_sentences set sentence_index=sentence_index+10 where passage_id=$1", [legacyId]);
  await pg.query("update ready_passage_sentences set sentence_index=case id when $2 then 1 when $3 then 3 else 4 end, paragraph_index=case id when $2 then 0 else 1 end where passage_id=$1", [legacyId, legacyRows[0], legacyRows[1]]);
  await pg.query("insert into ready_passage_sentences(passage_id,sentence_index,text,translation,block_type,paragraph_index,active) values ($1,0,'Lesson Title','','TITLE',0,true),($1,2,'Part Two','','SUBTITLE',1,true)", [legacyId]);
  const legacyEditor = await call('passage_editor', { passageId: legacyId }, admin);
  assert.deepEqual(legacyEditor.rows.map(row => row.blockType), ['TITLE', 'SENTENCE', 'SUBTITLE', 'SENTENCE', 'SENTENCE']);
  const sentenceRows = legacyEditor.rows.filter(row => row.blockType === 'SENTENCE');
  await call('save_passage', { passageId: legacyId, title: 'Legacy', grade: '1학년', sourceType: 'TEXTBOOK', rows: [sentenceRows[0], { ...sentenceRows[1], text: 'Second line edited.' }, { text: 'A new fourth line.', translation: '넷째' }, sentenceRows[2]], expectedRevision: legacyEditor.passage.canonical_revision }, admin);
  const legacyAfter = (await pg.query('select block_type,paragraph_index,text from ready_passage_sentences where passage_id=$1 and active order by sentence_index', [legacyId])).rows;
  assert.deepEqual(legacyAfter.map(row => [row.block_type, row.paragraph_index, row.text]), [['TITLE', 0, 'Lesson Title'], ['SENTENCE', 0, 'First line here.'], ['SUBTITLE', 1, 'Part Two'], ['SENTENCE', 1, 'Second line edited.'], ['SENTENCE', 1, 'A new fourth line.'], ['SENTENCE', 1, 'Third line here.']], 'structure rows and paragraphs are kept');
  assert.deepEqual(mergePassageStructure([{ id: 't', block_type: 'SUBTITLE', paragraph_index: 2, text: 'Tail', translation: '' }], [{ id: null, blockType: 'SENTENCE', paragraphIndex: 0, text: 'x y', translation: 'z' }]).map(row => row.blockType), ['SUBTITLE', 'SENTENCE'], 'a leading subtitle stays first');
  await call('delete_passage', { passageId: legacyId }, admin);

  // PostgREST silently caps a select at max-rows; lists are paged past it.
  const fillers = [];
  for (let index = 0; index < 3; index += 1) fillers.push((await call('create_passage', { title: `Filler ${index}`, grade: '1학년', rows: [{ text: `Filler sentence number ${index}.`, translation: '채움' }] }, admin)).passageId);
  for (let index = 0; index < 3; index += 1) await call('create_student', { name: `채움 ${index}`, school: '동고', grade: '2학년', code: `90000${index}` }, admin);
  await call('set_scope_passages', { school: '중앙고', grade: '1학년', passageIds: [passageId, ...fillers] }, admin);
  globalThis.__readyMaxRows = 2;
  try {
    const paged = await call('teacher_bootstrap', {}, admin);
    const counts = (await pg.query('select (select count(*) from ready_students)::int s, (select count(*) from ready_passages)::int p, (select count(*) from ready_exam_passages)::int l')).rows[0];
    assert.ok(counts.p > 2 && counts.l > 2, 'the fixture has more rows than the emulated cap');
    assert.deepEqual([paged.students.length, paged.passages.length, paged.examPassages.length], [counts.s, counts.p, counts.l], 'teacher_bootstrap returns every row');
    assert.equal((await call('student_bootstrap_active', {}, token)).passages.length, 4, 'the student home lists every linked set');
    const pagedPassage = await call('student_passage', { examId: scope.id, passageId }, token);
    assert.equal(pagedPassage.sentences.length, (await pg.query('select count(*)::int c from ready_passage_sentences where passage_id=$1 and active', [passageId])).rows[0].c);
    const pagedProgress = await call('admin_learning_progress', { period: '30d' }, admin);
    const steps = pagedProgress.students.find(item => item.id === student.id).steps, stored = (await pg.query("select stage, count(*)::int c from ready_workbook_attempts where student_id=$1 group by stage", [student.id])).rows;
    assert.ok(stored.reduce((sum, row) => sum + row.c, 0) > 2);
    assert.deepEqual([steps[1].total, steps[2].total], [1, 2].map(stage => stored.find(row => row.stage === stage)?.c || 0), 'the attempt summary reads past the cap');
  } finally { delete globalThis.__readyMaxRows; }

  // "today" starts at 00:00 Korean time.
  assert.equal(learningSince('today', Date.parse('2026-10-31T01:30:00+09:00')).toISOString(), '2026-10-30T15:00:00.000Z');
  assert.equal(learningSince('today', Date.parse('2026-10-31T23:59:00+09:00')).toISOString(), '2026-10-30T15:00:00.000Z');
  assert.equal(learningSince('7d', Date.parse('2026-10-31T10:00:00+09:00')).toISOString(), '2026-10-23T15:00:00.000Z');

  // Malformed requests and removed operations.
  const malformed = await (await import('./helpers/ready-api.mjs')).rawRequest('{not json');
  assert.equal(malformed.status, 400, 'malformed JSON is a client error');
  assert.match((await (await request('student_workbook', {}, token)).json()).error, /새로고침|업데이트/, 'old clients are told to reload or update');

  // Login throttling: one client guessing different codes is stopped; another
  // client and the admin are not locked out by it.
  const guesser = { 'x-forwarded-for': '203.0.113.7' }, classroom = { 'x-forwarded-for': '198.51.100.20' };
  let throttled = 0;
  for (let index = 0; index < 32; index += 1) if ((await request('student_login', { code: String(500000 + index) }, '', guesser)).status === 429) throttled += 1;
  assert.ok(throttled >= 2, 'a client guessing many different codes is rate limited');
  assert.equal((await request('student_login', { code: '246810' }, '', guesser)).status, 429, 'the guesser stays blocked even with a valid code');
  assert.equal((await request('student_login', { code: '246810' }, '', classroom)).status, 200, 'other clients can still log in');
  for (let index = 0; index < 6; index += 1) await request('admin_login', { password: 'wrong' }, '', guesser);
  assert.equal((await request('admin_login', { password: 'wrong' }, '', guesser)).status, 429);
  assert.equal((await request('admin_login', { password: 'ready-local' }, '', classroom)).status, 200, 'bad admin guesses from one client do not lock the teacher out');
  const failure = await request('delete_student', { studentId: 'not-a-uuid' }, admin);
  assert.equal(failure.status, 500);
  assert.doesNotMatch((await failure.json()).error, /uuid|syntax|ready_/i, 'database error text is not sent to the client');

  // Access control and deletion.
  const other = (await call('create_passage', { title: '배정 안 됨', grade: '1학년', rows }, admin)).passageId;
  await call('set_scope_passages', { school: '중앙고', grade: '1학년', passageIds: [passageId] }, admin);
  await assert.rejects(() => call('student_passage', { examId: scope.id, passageId: other }, token), /시험범위/);
  const impact = await call('delete_impact', { targetType: 'student', targetId: student.id }, admin);
  assert.deepEqual(impact.counts, { attempts: Number((await pg.query('select count(*) from ready_workbook_attempts where student_id=$1', [student.id])).rows[0].count) });
  assert.ok(impact.counts.attempts > 3);
  await call('delete_student', { studentId: student.id }, admin);
  assert.equal((await request('student_bootstrap_active', {}, token)).status, 401);
  await call('delete_passage', { passageId: other }, admin);
  await call('logout', {}, admin);
  assert.equal((await request('teacher_bootstrap', {}, admin)).status, 401);
  console.log('READY sentence-practice API integration (PGlite) passed.');
} finally {
  await close();
}
