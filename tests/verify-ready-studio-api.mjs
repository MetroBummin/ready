import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {pg,call,admin,aiCalls,close,repo} from './helpers/ready-studio-api.mjs';
import {livePrefixState} from '../ready/workbook-assistance.js';
import {inspectStudioDocument} from '../server/ready/studio-import.mjs';
const source=readFileSync(new URL('./fixtures/studio/september-2026.txt',import.meta.url),'utf8');
const sections=inspectStudioDocument(source,{title:'2026년 9월 고2'}),imported={drafts:[]};
for(const section of sections){const result=await call('studio_import',{title:section.title,sourceKind:'text',sourceText:section.rows.map(r=>r.text+'\t'+r.translation).join('\n'),sourceType:'MOCK_EXAM',grade:'2학년',sourceYear:2026,sourceMonth:9},admin);imported.drafts.push(...result.drafts);}
assert.equal(imported.drafts.length,4);assert.equal(aiCalls.length,0);
const passageIds=[];
for(const d of imported.drafts){const saved=await call('studio_create_draft',{jobId:d.job.id,title:d.job.title,rows:d.rows,boundaryConfirmed:true},admin);passageIds.push(saved.passageId);}
const passageId=passageIds[0];let context=await call('studio_open',{passageId},admin);
const callContext=(op,data={})=>call(op,{passageId,revision:context.passage.canonical_revision,version:context.studio.version,...data},admin);
assert.equal((await pg.query('select * from ready_workbook_catalogs')).rows.length,0);
let result=await callContext('studio_author');context.studio=result.studio;assert.equal(aiCalls.length,2);assert.equal(aiCalls[0].length,8);assert.equal(aiCalls[1].length,1);
const stateBefore=structuredClone(context.studio);
await assert.rejects(()=>callContext('studio_confirm_step',{step:'english_blank',confirmations:[{sentenceId:context.rows[0].id,targets:[]},{sentenceId:'missing',targets:[]}]}));
assert.deepEqual((await call('studio_open',{passageId},admin)).studio,stateBefore,'invalid batch must not partially confirm');
for(const step of ['english_blank','korean_blank','verb_form','grammar_choice']){result=await callContext('studio_confirm_step',{step,confirmations:context.rows.map(row=>({sentenceId:row.id,targets:context.studio.annotations[row.id].steps[step].targets}))});context.studio=result.studio;}
await assert.rejects(()=>call('studio_confirm_step',{passageId,revision:0,version:0,sentenceId:context.rows[0].id,step:'english_blank',targets:[]},admin));
result=await callContext('studio_publish');context.studio=result.studio;
assert.equal(result.catalog.stages.length,7);
const before=structuredClone(context.studio.annotations),catalog=result.catalog;
const studentId=crypto.randomUUID(),examId=crypto.randomUUID();
await pg.query("insert into ready_students(id,name,school,grade) values($1,'Studio QA','test2','2학년')",[studentId]);
if(!(await pg.query("select id from ready_exams where school='test2' and grade='2학년'")).rows.length)await pg.query("insert into ready_exams(id,title,school,grade,is_current) values($1,'Studio QA','test2','2학년',true)",[examId]);
const exam=(await pg.query("select id from ready_exams where school='test2' and grade='2학년'")).rows[0].id;
assert.equal((await pg.query('select count(*)::integer as count from ready_exam_passages where exam_id=$1',[exam])).rows[0].count,passageIds.length,'Every grade-2 Passage must be assigned to the test2 QA scope automatically');
assert.equal((await pg.query('select count(*)::integer as count from ready_exam_passages where exam_id=$1 and passage_id=$2',[exam,passageId])).rows[0].count,1);
const token='local-student-session-for-studio-testing-0001',hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
await pg.query("insert into ready_sessions(token_hash,actor_type,student_id,expires_at) values($1,'student',$2,now()+interval '1 day')",[Buffer.from(hash).toString('hex'),studentId]);
let workbook=await call('student_workbook',{examId:exam,passageId},token);
const writing=workbook.stages.find(s=>s.stage===7).items[0],answer=catalog.stages.find(s=>s.stage===7).items[0].answers[0];
assert.equal(writing.kind,'full_sentence_input');assert.equal(writing.source,context.rows[0].translation);assert.equal(writing.assistance.mode,'prefix_typing');writing.assistance=(await call('workbook_assistance',{examId:exam,passageId,itemKey:writing.key},token)).assistance;assert.equal(writing.assistance.slots.length,1);
const prefix=answer.slice(0,9);assert.equal((await livePrefixState(prefix,writing.assistance.slots[0])).valid,true);
const mismatch=await livePrefixState(prefix+'Z',writing.assistance.slots[0]);assert.equal(mismatch.valid,false);assert.equal(mismatch.mismatchIndex,prefix.length);
assert.equal((await livePrefixState(answer,writing.assistance.slots[0])).complete,true);

const item=catalog.stages[1].items[0];
await call('submit_workbook_attempt',{examId:exam,passageId,itemKey:item.key,responses:item.answers},token);
const attemptBefore=(await pg.query('select * from ready_workbook_attempts')).rows;
assert.equal(attemptBefore.length,1);
const edited=structuredClone(context.rows);edited[3].text+=' Today.';
await call('save_passage_canonical',{passageId,title:context.passage.title,sourceType:'MOCK_EXAM',grade:'2학년',sourceYear:2026,sourceMonth:9,rows:edited},admin);
context=await call('studio_open',{passageId},admin);
const dirty=context.rows.filter(r=>context.studio.annotations[r.id].steps.english_blank.status!=='confirmed');assert.equal(dirty.length,1);
assert.deepEqual(context.studio.annotations[edited[0].id],before[edited[0].id]);
await assert.rejects(()=>callContext('studio_publish'));
result=await callContext('studio_author');context.studio=result.studio;assert.deepEqual(aiCalls[2],[edited[3].id]);
for(const step of ['english_blank','korean_blank','verb_form','grammar_choice']){result=await callContext('studio_confirm_step',{sentenceId:edited[3].id,step,targets:context.studio.annotations[edited[3].id].steps[step].targets});context.studio=result.studio;}
await callContext('studio_publish');assert.deepEqual((await pg.query('select * from ready_workbook_attempts')).rows,attemptBefore);
workbook=await call('student_workbook',{examId:exam,passageId},token);assert.equal(workbook.stages.find(s=>s.stage===2).attempted,1);
assert.equal((await pg.query('select * from ready_workbook_catalogs')).rows.length,1);assert.equal(aiCalls.length,3);
// Boundary merge keeps both publisher sources and rejects cross-document merges.
const mergeDrafts=[];
for(const n of [1,2]){const d=(await call('studio_import',{title:'Merge '+n,sourceKind:'text',sourceText:sections[0].rows.map(r=>r.text+'\t'+r.translation).join('\n'),sourceType:'TEXTBOOK',grade:'2학년'},admin)).drafts[0];mergeDrafts.push(d);await pg.query('update ready_workbook_factory_jobs set source_metadata=$1,extraction=$2 where id=$3',[JSON.stringify({documentSha256:'same-document',pages:[n]}),JSON.stringify({sourceExercises:[{sourceExerciseKey:'source-'+n}]}),d.job.id]);}
const mergeBody={jobId:mergeDrafts[0].job.id,mergeJobId:mergeDrafts[1].job.id,title:'Merged',rows:mergeDrafts.flatMap(d=>d.rows)};
const merged=await call('studio_split_draft',mergeBody,admin);assert.equal(merged.job.extraction.sourceExercises.length,2);assert.deepEqual(merged.job.source_metadata.pages,[1,2]);
await pg.query('update ready_workbook_factory_jobs set source_metadata=$1 where id=$2',[JSON.stringify({documentSha256:'different-document'}),mergeDrafts[1].job.id]);
await assert.rejects(()=>call('studio_split_draft',mergeBody,admin));assert.equal(aiCalls.length,3);
console.log('PASS real API + PostgreSQL: 4 drafts, 7 stages, student attempt, dirty-only AI, stale publication blocked, history retained.');
await close();
