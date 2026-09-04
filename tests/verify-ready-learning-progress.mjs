import assert from 'node:assert/strict';
import fs from 'node:fs';
import { attemptMetrics, groupAttemptCounts, latestAttemptAt, learningPeriodStart, progressAccuracy } from '../ready/admin/learning-progress.js';
import { questionAttemptReplayHtml, workbookAttemptReplayHtml } from '../ready/admin/attempt-replay.js';

const now=new Date('2026-09-04T06:30:00.000Z');
assert.equal(learningPeriodStart('today',now).toISOString(),'2026-09-03T15:00:00.000Z');
assert.equal(learningPeriodStart('7d',now).toISOString(),'2026-08-28T15:00:00.000Z');
assert.equal(learningPeriodStart('30d',now).toISOString(),'2026-08-05T15:00:00.000Z');
const attempts=[{id:'a1',itemId:'q1',correct:false,created_at:'2026-09-04T01:00:00Z'},{id:'a2',itemId:'q1',correct:true,created_at:'2026-09-04T02:00:00Z'},{id:'a3',itemId:'q1',correct:false,created_at:'2026-09-04T03:00:00Z'}];
assert.deepEqual(attemptMetrics(attempts),{total:3,correct:1,wrong:2,accuracy:33});
assert.deepEqual(attemptMetrics([]),{total:0,correct:0,wrong:0,accuracy:null});
assert.equal(progressAccuracy(5,6),83);
assert.equal(progressAccuracy(0,0),null);
assert.equal(latestAttemptAt(attempts,[{created_at:'2026-09-04T04:00:00Z'}]),'2026-09-04T04:00:00.000Z');
assert.deepEqual(groupAttemptCounts(attempts).get('q1'),{attempts:3,wrong:2});

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const interaction={kind:'choice_list',selection:'single',passage:{visible:true,segments:[{kind:'text',text:'Replay passage.'}]},choices:{columns:[],rows:['one','two','three','four','five'].map((text,index)=>({id:`c${index}`,cells:[text]}))},response:{layout:'choice',slots:[]}};
const questionReplay=questionAttemptReplayHtml({replayable:true,attempt:{correct:false},passage:{title:'Passage'},question:{responseType:'choice',interaction:'choice_list',interactionContract:interaction,choices:['one','two','three','four','five'],prompt:'정답을 고르시오.',renderSpec:{extras:[]},explanation:'해설',renderer:'standard_mcq'},response:{selected:[4]},answer:[2],snapshot:{currentGeneration:3}},escape);
assert.match(questionReplay,/question-choice[^>]*wrong[\s\S]*⑤/,'student selection must be marked wrong');
assert.match(questionReplay,/question-choice[^>]*correct[\s\S]*③/,'correct answer must be marked correct');
assert.match(questionReplay,/학생 제출[\s\S]*⑤ five/);
assert.match(questionReplay,/정답[\s\S]*③ three/);
assert.match(questionReplay,/READ ONLY/);
assert.match(questionReplay,/generation 3/);
assert.doesNotMatch(questionReplay,/data-submit-question|data-workbook-hint/);

const workbookReplay=workbookAttemptReplayHtml({replayable:true,attempt:{hint_count:1,used_full_answer_hint:false},passage:{title:'Lesson 2'},workbook:{title:'Workbook'},item:{stage:7,kind:'correction_pairs',subtype:'grammar',prompt:'It was interesting.',pairCount:1},response:['interesting','interest'],answers:['interesting','interested'],slotResults:[true,false]},escape);
assert.match(workbookReplay,/value="interest" disabled/);
assert.match(workbookReplay,/정답: interesting → interested/);
assert.match(workbookReplay,/힌트 1회/);
assert.doesNotMatch(workbookReplay,/data-submit-workbook|data-workbook-hint/);
const fallback=workbookAttemptReplayHtml({replayable:false,message:'현재 문항 버전과 일치하지 않아 완전 재현 불가',attempt:{response:{responses:['saved answer']}}},escape);
assert.match(fallback,/완전 재현 불가/);
assert.match(fallback,/saved answer/);

const server=fs.readFileSync(new URL('../server/ready/index.ts',import.meta.url),'utf8');
const adminApp=fs.readFileSync(new URL('../ready/admin/app.js',import.meta.url),'utf8');
const adminSet=server.match(/const adminOps = new Set\(\[([^\]]+)\]\)/)?.[1]||'',studentSet=server.match(/const studentOps = new Set\(\[([^\]]+)\]\)/)?.[1]||'';
for(const op of ['admin_learning_progress','admin_learning_progress_detail','admin_attempt_replay'])assert.ok(adminSet.includes(op),`${op} must require Admin auth`);
assert.doesNotMatch(studentSet,/admin_learning_progress|admin_attempt_replay/,'Student auth must not access Admin analytics');
assert.match(server,/ready_attempts[\s\S]*ready_workbook_attempts/);
assert.match(server,/\.eq\("student_id", studentId\)\.gte\("created_at", since\)/);
assert.match(server,/attempt\.response/,'replay must use the selected attempt response');
assert.match(server,/현재 문항 버전과 일치하지 않아 완전 재현할 수 없습니다/);
assert.match(server,/questionAttempts\.filter\(attempt => attempt\.correct === false\)/,'Question wrong list must contain only incorrect attempts');
assert.match(server,/workbookAttempts\.filter\(attempt => attempt\.correct === false\)/,'Workbook wrong list must contain only incorrect attempts');
assert.match(adminApp,/admin_learning_progress[\s\S]*school:learning\.school,grade:learning\.grade/,'summary request must carry school and grade filters');
assert.match(adminApp,/선택한 기간에 학습 기록이 없습니다/,'students without period attempts need a clear empty state');

const migration=fs.readFileSync(new URL('../supabase/migrations/20260904062636_admin_learning_progress_summary.sql',import.meta.url),'utf8');
assert.match(migration,/security invoker/i);
assert.match(migration,/count\(\*\) filter \(where a\.correct\)/);
assert.match(migration,/max\(activity\.created_at\)/);
assert.match(migration,/revoke all[\s\S]*anon, authenticated/);
assert.doesNotMatch(migration,/\b(insert|update|delete|truncate)\b/i,'analytics migration must remain read-only');

console.log('READY Admin learning progress checks passed.');
