import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {admin,call,close,pg} from './helpers/ready-studio-api.mjs';
import {contentClaimEvidence,gradeContentClaim} from '../ready/content-claim.js';
import {contentClaimBag,contentClaimStage,factStale,insertContentClaimStage,publicContentClaims,selectContentClaimVariant} from '../server/ready/content-claim.mjs';

const passageId=crypto.randomUUID(),sentenceA=crypto.randomUUID(),sentenceB=crypto.randomUUID();
await pg.query("insert into ready_passages(id,title,source_text,display_order,source_type,grade,source_label,study_status,translation_source,processing_error) values($1,'Content Claim QA','Ice melted. Temperatures rose.',0,'TEXTBOOK','2학년','fixture','ready','teacher','')",[passageId]);
await pg.query("insert into ready_passage_sentences(id,passage_id,sentence_index,text,translation,block_type,paragraph_index,active) values($1,$3,0,'The ice melted because temperatures rose.','기온이 올라 얼음이 녹았다.','SENTENCE',0,true),($2,$3,1,'Scientists measured the change.','과학자들은 변화를 측정했다.','SENTENCE',0,true)",[sentenceA,sentenceB,passageId]);

let saved=await call('content_claim_bank_save',{passageId,entity:'fact',factText:'Rising temperatures caused the ice to melt.',evidenceSentenceIds:[sentenceA,sentenceB],status:'confirmed'},admin);
const factA=saved.contentBank.facts[0];
assert.deepEqual(factA.evidence_sentence_ids,[sentenceA,sentenceB]);
assert.deepEqual(factA.evidence_snapshot.map(item=>item.sentenceId),[sentenceA,sentenceB]);
saved=await call('content_claim_bank_save',{passageId,entity:'claim',factId:factA.id,statement:'The ice melted because temperatures rose.',truth:true,language:'en',difficulty:1,status:'confirmed'},admin);
const trueClaim=saved.contentBank.claims[0];
const variantInputs=[
  ['ko-d1','기온이 올라 얼음이 녹았다.','ko',1,'confirmed'],
  ['ko-d2','얼음이 녹은 원인은 기온 상승이었다.','ko',2,'confirmed'],
  ['en-d1','Higher temperatures melted the ice.','en',1,'confirmed'],
  ['en-d2','The rise in temperature resulted in melting ice.','en',2,'confirmed'],
  ['en-d3','The thaw was attributed to an increase in temperature.','en',3,'confirmed'],
  ['draft-hidden','Draft must stay hidden.','en',3,'draft'],
  ['stale-hidden','Stale must stay hidden.','ko',1,'stale'],
];
for(const [variantKey,statement,language,difficulty,status] of variantInputs) saved=await call('content_claim_bank_save',{passageId,entity:'variant',claimId:trueClaim.id,variantKey,statement,language,difficulty,status},admin);
const draftVariant=saved.contentBank.variants.find(variant=>variant.variant_key==='draft-hidden');
saved=await call('content_claim_bank_save',{passageId,entity:'variant',id:draftVariant.id,claimId:trueClaim.id,statement:'Edited draft stays hidden.',language:'en',difficulty:2,status:'draft'},admin);
assert.equal(saved.contentBank.variants.find(variant=>variant.id===draftVariant.id).statement,'Edited draft stays hidden.');
saved=await call('content_claim_bank_save',{passageId,entity:'variant',claimId:trueClaim.id,variantKey:'delete-me',statement:'Delete me.','language':'en',difficulty:1,status:'draft'},admin);
const deletedVariant=saved.contentBank.variants.find(variant=>variant.variant_key==='delete-me');
saved=await call('content_claim_bank_delete',{passageId,entity:'variant',id:deletedVariant.id},admin);
assert.equal(saved.contentBank.variants.some(variant=>variant.id===deletedVariant.id),false);
saved=await call('content_claim_bank_save',{passageId,entity:'claim',factId:factA.id,statement:'The melting ice caused temperatures to rise.',truth:false,language:'en',difficulty:2,mutationType:'causality_reversal',status:'confirmed'},admin);
const falseClaim=saved.contentBank.claims.find(claim=>claim.id!==trueClaim.id);
assert.equal(saved.contentBank.claims.length,2,'one Fact must own multiple Claims');
saved=await call('content_claim_bank_save',{passageId,entity:'claim',id:falseClaim.id,factId:factA.id,statement:'The ice caused temperatures to rise.',truth:false,language:'en',difficulty:3,mutationType:'causality_reversal',status:'draft'},admin);
assert.equal(saved.contentBank.claims.find(claim=>claim.id===falseClaim.id).difficulty,3);
let reloaded=await call('studio_open',{passageId},admin);
assert.equal(reloaded.contentBank.facts.length,1);
assert.equal(reloaded.contentBank.claims.find(claim=>claim.id===falseClaim.id).status,'draft','CRUD changes must survive reload');
assert.equal(reloaded.contentBank.variants.find(variant=>variant.id===draftVariant.id).statement,'Edited draft stays hidden.','Variant CRUD changes must survive reload');
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
assert.equal(claimStage.total,2,'Variants must not increase the semantic Claim denominator');
const trueItem=claimStage.items.find(item=>item.claimId===trueClaim.id);
assert.equal(trueItem.statement,'기온이 올라 얼음이 녹았다.','0~100% must prefer ko_d1');
assert.equal(trueItem.variantId,reloaded.contentBank.variants.find(variant=>variant.variant_key==='ko-d1').id);
const fallbackItem=claimStage.items.find(item=>item.factId===factB.id);
assert.equal(fallbackItem.statement,'Scientists measured the change.','Claims without Variants must use the parent Claim statement');
const attempt=await call('submit_workbook_attempt',{examId,passageId,itemKey:trueItem.key,responses:['O'],clientAttemptId:crypto.randomUUID()},token);
assert.equal(attempt.correct,true,'Variant O/X must be graded with parent Claim.truth');
assert.equal((await pg.query('select stage_item_count from ready_workbook_attempts where id=$1',[attempt.attempt.id])).rows[0].stage_item_count,2,'persisted progress denominator must remain the parent Claim count');

await pg.query("update ready_passage_sentences set text='The ice melted for an unknown reason.' where id=$1",[sentenceA]);
workbook=await call('student_workbook',{examId,passageId},token);claimStage=workbook.stages.find(stage=>stage.semanticType==='content_claim');
assert.equal(claimStage.items.length,1,'a changed evidence sentence must exclude only its Fact Claims');
assert.equal((await pg.query('select status from ready_content_facts where id=$1',[factA.id])).rows[0].status,'stale');
assert.equal((await pg.query('select status from ready_content_facts where id=$1',[factB.id])).rows[0].status,'confirmed','unrelated Facts must remain confirmed');
await assert.rejects(call('content_claim_bank_publish_all',{passageId},admin),error=>error.status===422&&/근거 재확인/.test(error.message));
await pg.query("delete from ready_content_claims where passage_id=$1 and status='stale'",[passageId]);
await pg.query('delete from ready_content_facts where id=$1',[factA.id]);
const published=await call('content_claim_bank_publish_all',{passageId},admin);
assert.equal(published.published,true);
assert.equal(published.contentBank.facts.every(fact=>fact.status==='confirmed'),true);
assert.equal(published.contentBank.claims.every(claim=>claim.status==='confirmed'),true);

assert.deepEqual(gradeContentClaim(true,'O'),{valid:true,correct:true});
assert.deepEqual(gradeContentClaim(true,'X'),{valid:true,correct:false});
assert.deepEqual(gradeContentClaim(false,'X'),{valid:true,correct:true});
assert.deepEqual(gradeContentClaim(false,'O'),{valid:true,correct:false});
assert.deepEqual(contentClaimEvidence({evidence:[{text:'A'},{text:'B'}]}).map(row=>row.text),['A','B']);
assert.deepEqual(insertContentClaimStage([{semanticType:'translation'},{semanticType:'korean_blank'}],[{id:'claim-1',statement:'A',truth:true}]).map(stage=>stage.semanticType),['translation','content_claim','korean_blank']);
assert.equal(factStale(factB,reloaded.rows),false);
const publicClaims=publicContentClaims(reloaded.contentBank.facts,reloaded.contentBank.claims,reloaded.contentBank.variants,reloaded.rows);
assert.equal(publicClaims.flatMap(claim=>claim.variants).every(variant=>variant.status==='confirmed'),true,'draft/stale Variants must be filtered');

const tierClaim={...publicClaims.find(claim=>claim.id===trueClaim.id),variants:reloaded.contentBank.variants.filter(variant=>variant.claim_id===trueClaim.id)};
assert.equal(selectContentClaimVariant(tierClaim,0,()=>0).variant_key,'ko-d1');
assert.equal(selectContentClaimVariant(tierClaim,100,()=>0).variant_key,'ko-d2');
assert.equal(selectContentClaimVariant(tierClaim,200,()=>0).variant_key,'en-d2');
assert.equal(selectContentClaimVariant(tierClaim,300,()=>0).variant_key,'en-d3');
assert.equal(selectContentClaimVariant(tierClaim,300,()=>0.99).variant_key,'en-d2','300%+ may mix en_d2 to avoid repetition');
assert.equal(contentClaimStage([{...tierClaim,variants:[]}],{},()=>0).items[0].statement,tierClaim.statement,'nearest fallback must end at the parent statement when no Variant exists');

const bag=contentClaimBag([
  {id:'a1',factId:'a',truth:true},{id:'a2',factId:'a',truth:false},
  {id:'b1',factId:'b',truth:true},{id:'b2',factId:'b',truth:false},
  {id:'c1',factId:'c',truth:true},{id:'c2',factId:'c',truth:false},
],()=>0.75);
assert.equal(new Set(bag.map(claim=>claim.id)).size,bag.length,'a Claim must not repeat before the bag is exhausted');
assert.equal(bag.some((claim,index)=>index>0&&claim.factId===bag[index-1].factId),false,'adjacent Claims must avoid the same Fact when possible');
assert.equal(bag.some((claim,index)=>index>1&&claim.truth===bag[index-1].truth&&claim.truth===bag[index-2].truth),false,'TRUE/FALSE streaks must be bounded when possible');

const edge=readFileSync(new URL('../server/ready/index.ts',import.meta.url),'utf8'),app=readFileSync(new URL('../ready/app.js',import.meta.url),'utf8'),studio=readFileSync(new URL('../ready/admin/studio-ui.js',import.meta.url),'utf8');
assert.doesNotMatch(edge,/contentClaim[\s\S]{0,500}(?:gemini|openai|claude)/i,'Content Claim must not call AI');
assert.match(app,/gradeContentClaim\(item\.truth,choice\)/,'O/X grading must happen locally');
assert.match(studio,/data-content-fact-panel/,'Fact cards must use collapsible compact panels');
assert.match(studio,/content-evidence-picker/,'evidence sentence lists must stay collapsed until requested');
assert.match(studio,/data-content-filter="review"/,'Claim Bank must expose review-first filtering');
assert.match(studio,/data-content-publish-all/,'Claim Bank must expose one-step review and publish');
console.log('READY Content Claim Variant CRUD, semantic bag/tier progress, stable evidence, local O/X and Claim Bank regression passed.');
await close();
