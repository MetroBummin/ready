import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMockExamTitle, presentPassageTitle } from '../ready/passage-presentation.js';

const canonical = '2026년 9월 고1 모의고사 21번';
assert.deepEqual(parseMockExamTitle(canonical), {
  year: 2026,
  month: 9,
  grade: '고1',
  question: '21',
  questionLabel: '21번',
  questionSource: 'title',
});
assert.equal(parseMockExamTitle('26년 9월 고2 모의고사 21번').year, 2026, 'Confirmed two-digit-year titles remain a safe source pattern.');
assert.equal(parseMockExamTitle('2026년 9월 · 고1 모의고사 - 41~42번.').questionLabel, '41~42번');
assert.equal(parseMockExamTitle('2026년 9월 고1 모의고사 1번').questionLabel, '1번');
assert.equal(parseMockExamTitle(canonical, { source_question_no: '41~42' }).questionLabel, '41~42번', 'Explicit metadata may safely override a canonical title number.');
for (const unsafe of [
  '2026년 9월 고1 모의고사 21번 풀이',
  '2026년 9월 고1 21번',
  '공통영어2 NE(민병천) 1과',
]) assert.equal(parseMockExamTitle(unsafe), null, `Loose or trailing title must not expose a question number: ${unsafe}`);

const presented = presentPassageTitle({
  source_type: 'MOCK_EXAM',
  title: canonical,
  grade: '1학년',
  source_year: 2025,
  source_month: 3,
  sourceQuestionNo: 21,
});
assert.deepEqual(presented, {
  title: canonical,
  fallbackTitle: canonical,
  question: '21',
  questionLabel: '21번',
  questionSource: 'metadata',
  grade: '고1',
  sourceYear: 2025,
  sourceMonth: 3,
  metaLabel: '고1 · 2025년 3월',
}, 'Stored grade/year/month must lead the compact metadata label.');
assert.equal(presentPassageTitle({ source_type: 'MOCK_EXAM', title: '검증 대기 제목', grade: '고1', source_year: 2026, source_month: 9, metadata: { questionNumber: '41~42번' } }).questionLabel, '41~42번', 'Explicit question metadata does not need a title fallback.');
assert.equal(presentPassageTitle({ source_type: 'TEXTBOOK', title: canonical, questionNumber: 21 }), null, 'Textbooks never receive a mock-exam title treatment.');
assert.equal(presentPassageTitle({ source_type: 'MOCK_EXAM', title: `${canonical} 풀이` }), null, 'Trailing title content must use the original-title fallback.');
assert.equal(presentPassageTitle({ source_type: 'MOCK_EXAM', title: '검증 대기 제목', grade: '고1', source_year: 2026, source_month: 9, index: 21 }), null, 'List indices must never become question numbers.');
assert.equal(presentPassageTitle({ source_type: 'MOCK_EXAM', title: canonical, questionNumber: 21, source_question_no: 22 }), null, 'Conflicting explicit metadata must fail closed.');

const app = fs.readFileSync(new URL('../ready/app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server/ready/index.ts', import.meta.url), 'utf8');
assert.match(app, /presentPassageTitle/, 'Student list must use the safe presentation helper.');
assert.match(app, /passage-exam-number/, 'Student list must render the actual mock question number.');
assert.match(server, /id,title,source_type,grade,source_year,source_month,source_label,updated_at/, 'Active bootstrap must return the stored source metadata needed by the presentation helper.');

console.log('READY Passage presentation keeps mock-exam numbers source-grounded.');
