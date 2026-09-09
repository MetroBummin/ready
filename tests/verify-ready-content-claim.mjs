import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {admin,call,close,pg} from './helpers/ready-studio-api.mjs';
import {contentClaimEvidence,gradeContentClaim} from '../ready/content-claim.js';
import {insertContentClaimStage} from '../server/ready/content-claim.mjs';
import {factStale,publicContentClaims} from '../server/ready/content-claim.mjs';

const passageId=crypto.randomUUID(),sentenceA=crypto.randomUUID(),sentenceB=crypto.randomUUID();
await pg.query("insert into ready_passages(id,title,source_text,display_order,source_type,grade,source_label,study_status,translation_source,processing_error) values($1,'Content Claim QA','Ice melted. Temperatures rose.',0,'TEXTBOOK','2학년','fixture','ready','teacher','')",[passageId]);
await pg.query("insert into ready_passage_sentences(id,passage_id,sentence_index,text,translation,block_type,paragraph_index,active) values($1,$3,0,'The ice melted because temperatures rose.','기온이 올라 얼음이 녹았다.','SENTENCE',0,true),($2,$3,1,'Scientists measured the change.','과학자들은 변화를 측정했다.','SENTENCE',0,true)",[sentenceA,sentenceB,passageId]);

let saved=await call('content_claim_bank_save',{passageId,entity:'fact',factText:'Rising temperatures caused the ice to melt.',evidenceSentenceIds:[sentenceA,sentenceB],status:'confirmed'},admin);
const factA=saved.contentBank.facts[0];
assert.deepEqual(factA.evidence_sentence_ids,[sentenceA,sentenceB]);
assert.deepEqual(factA.evidence_snapshot.map(item=>item.sentenceId),[sentenceA,sentenceB]);
saved=await call('content_claim_bank_save',{passageId,entity:'claim',factId:factA.id,statement:'The ice melted because temperatures rose.',truth:true,language:'en',difficulty:1,status:'confirmed'},admin);
const trueClaim=saved.contentBank.claims[0];
saved=await call('content_claim_bank_save',{passageId,entity:'claim',factId:factA.id,statement:'The melting ice caused temperatures to rise.',truth:false,language:'en',difficulty:2,mutationType:'causality_reversal',status:'confirmed'},admin);
const falseClaim=saved.contentBank.claims.find(claim=>claim.id!==trueClaim.id);
assert.equal(saved.contentBank.claims.length,2,'one Fact must own multiple Claims');
saved=await call('content_claim_bank_save',{passageId,entity:'claim',id:falseClaim.id,factId:factA.id,statement:'The ice caused temperatures to rise.',truth:false,language:'en',difficulty:3,mutationType:'causality_reversal',status:'draft'},admin);
assert.equal(saved.contentBank.claims.find(claim=>claim.id===falseClaim.id).difficulty,3);
let reloaded=await call('studio_open',{passageId},admin);
assert.equal(reloaded.contentBank.facts.length,1);
assert.equal(reloaded.contentBank.claims.find(claim=>claim.id===falseClaim.id).status,'draft','CRUD changes must survive reload');
saved=await call('content_claim_bank_delete',{passageId,entity:'claim',id:falseClaim.id},admin);
assert.equal(saved.contentBank.claims.length,1);

saved=await call('content_claim_bank_save',{passageId,entity:'fact',factText:'Scientists measured the change.',evidenceSentenceIds:[sentenceB],status:'confirmed'},admin);
const factB=saved.contentBank.facts.find(fact=>fact.id!==factA.id);
await call('content_claim_bank_save',{passageId,entity:'claim',factId:factB.id,statement:'Scientists measured the change.',truth:true,language:'en',difficulty:1,status:'confirmed'},admin);
await call('content_claim_bank_save',{passageId,entity:'claim',factId:factB.id,statement:'No measurements were made.',truth:false,language:'en',difficulty:1,status:'draft'},admin);
await pg.query("insert into ready_content_claims(passage_id,fact_id,statement,truth,language,difficulty,status) values($1,$2,'A stale claim.',false,'en',1,'stale')",[passageId,factB.id]);

await pg.query('update ready_passage_sentences set sentence_index=sentence_index+10 where passage_id=$1',[passageId]);
await pg.query("insert into ready_passage_sentences(passage_id,sentence_index,text,translation,block_type,paragraph_index,active) values($1,0,'A new leading sentence.','새 앞 문장.','SENTENCE',0,true)",[passageId]);
reloaded=await call('studio_open',{passageId},admin);
assert.equal(reloaded.contentBank.facts.find(fact=>fact.id===factA.id).status,'confirmed','index shifts must not stale stable sentence IDs');

const examId=crypto.randomUUID(),studentId=crypto.randomUUID(),token='content-claim-student-session-000000000001',hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
await pg.query("insert into ready_exams(id,title,school,grade,is_current) values($1,'Claim QA','claim-school','2학년',true)",[examId]);
await pg.query("insert into ready_students(id,name,school,grade) values($1,'Claim Student','claim-school','2학년')",[studentId]);
await pg.query('insert into ready_exam_passages(exam_id,passage_id,position) values($1,$2,0)',[examId,passageId]);
await pg.query("insert into ready_sessions(token_hash,actor_type,student_id,expires_at) values($1,'student',$2,now()+interval '1 day')",[Buffer.from(hash).toString('hex'),studentId]);
let workbook=await call('student_workbook',{examId,passageId},token),claimStage=workbook.stages.find(stage=>stage.semanticType==='content_claim');
assert.equal(claimStage.items.length,2,'only confirmed Claims under confirmed, current Facts are student-visible');
assert.equal(claimStage.items.find(item=>item.key.includes(trueClaim.id)).evidence.length,2,'multiple evidence sentences must render');

await pg.query("update ready_passage_sentences set text='The ice melted for an unknown reason.' where id=$1",[sentenceA]);
workbook=await call('student_workbook',{examId,passageId},token);claimStage=workbook.stages.find(stage=>stage.semanticType==='content_claim');
assert.equal(claimStage.items.length,1,'a changed evidence sentence must exclude only its Fact Claims');
assert.equal((await pg.query('select status from ready_content_facts where id=$1',[factA.id])).rows[0].status,'stale');
assert.equal((await pg.query('select status from ready_content_facts where id=$1',[factB.id])).rows[0].status,'confirmed','unrelated Facts must remain confirmed');

assert.deepEqual(gradeContentClaim(true,'O'),{valid:true,correct:true});
assert.deepEqual(gradeContentClaim(true,'X'),{valid:true,correct:false});
assert.deepEqual(gradeContentClaim(false,'X'),{valid:true,correct:true});
assert.deepEqual(gradeContentClaim(false,'O'),{valid:true,correct:false});
assert.deepEqual(contentClaimEvidence({evidence:[{text:'A'},{text:'B'}]}).map(row=>row.text),['A','B']);
assert.deepEqual(insertContentClaimStage([{semanticType:'translation'},{semanticType:'korean_blank'}],[{id:'claim-1',statement:'A',truth:true}]).map(stage=>stage.semanticType),['translation','content_claim','korean_blank']);
assert.equal(factStale(factB,reloaded.rows),false);
assert.equal(publicContentClaims([factB],saved.contentBank.claims,reloaded.rows).every(claim=>claim.status!=='draft'),true);

const edge=readFileSync(new URL('../server/ready/index.ts',import.meta.url),'utf8'),app=readFileSync(new URL('../ready/app.js',import.meta.url),'utf8');
assert.doesNotMatch(edge,/contentClaim[\s\S]{0,500}(?:gemini|openai|claude)/i,'Content Claim must not call AI');
assert.match(app,/gradeContentClaim\(item\.truth,choice\)/,'O/X grading must happen locally');
console.log('READY Content Claim CRUD, stable evidence identity, stale filtering, local O/X grading and evidence rendering passed.');
await close();
