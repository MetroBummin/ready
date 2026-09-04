import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeReviewExportOptions, reviewExportDocumentHtml } from '../ready/review-export.js';

const data={
  meta:{title:'2학기 중간고사',school:'신흥고',grade:'2학년',studentName:'테스트'},
  words:[{lemma:'review',meaning:'복습하다',examples:[{englishSentence:'Review the passage. & retry.',publisherTranslation:'지문을 복습하라.'}]}],
  questions:[{question:{prompt:'알맞은 것은?',passageText:'A < B',choices:['첫째','둘째'],responseType:'choice',interaction:'choice',explanation:'둘째가 정답이다.'},response:{selected:[0]},answer:[1]}],
  workbooks:[{title:'문장 완성',passageTitle:'Lesson 1',stage:4,number:1,prompt:'I _____ ready.',response:['am'],answers:['was']}],
};

assert.deepEqual(normalizeReviewExportOptions(data,{}),{answerMode:'appendix',kinds:['word','question','workbook']});
const appendix=reviewExportDocumentHtml(data,{answerMode:'appendix',kinds:['word','question','workbook']});
assert.match(appendix,/정답/);
assert.match(appendix,/Q1/);
assert.match(appendix,/W1/);
assert.doesNotMatch(appendix,/내 답/);
assert.match(appendix,/A &lt; B/);
assert.match(appendix,/Review the passage\. &amp; retry\./);

const included=reviewExportDocumentHtml(data,{answerMode:'included',kinds:['question']});
assert.match(included,/내 답/);
assert.match(included,/1\. 첫째/);
assert.match(included,/2\. 둘째/);
assert.doesNotMatch(included,/저장 단어/);

const excluded=reviewExportDocumentHtml(data,{answerMode:'excluded',kinds:['workbook']});
assert.doesNotMatch(excluded,/정답/);
assert.doesNotMatch(excluded,/내 답/);
assert.match(excluded,/I ________ ready\./);

const server=fs.readFileSync(new URL('../server/ready/index.ts',import.meta.url),'utf8');
assert.match(server,/student_review_export/);
assert.match(server,/async function studentReviewExport/);
assert.match(server,/lastResult === false/);
assert.match(server,/ready_attempts/);
assert.match(server,/ready_workbook_attempts/);

console.log('READY Review PDF export checks passed.');
