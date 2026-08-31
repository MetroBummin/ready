#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';
import { buildObjectiveSourceContract, buildStructuredSourceContract } from './ready-source-contract.mjs';

const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:'';};
const objectiveFile=value('--objective'),evidenceFile=value('--evidence'),writtenFile=value('--written'),output=value('--output');
if(!objectiveFile||!evidenceFile||!writtenFile||!output)throw new Error('Usage: node tools/ready-finalize-ne-bundle.mjs --objective objective-fallback.json --evidence objective-fallback-input.json --written written-pass.json --output final.json');

const objectiveBundle=JSON.parse(readFileSync(resolve(objectiveFile),'utf8'));
const evidenceBundle=JSON.parse(readFileSync(resolve(evidenceFile),'utf8'));
const writtenBundle=JSON.parse(readFileSync(resolve(writtenFile),'utf8'));
const objectiveSource=(objectiveBundle.questions||[]).filter(question=>question.type==='multiple_choice');
const writtenSource=(writtenBundle.questions||[]).filter(question=>question.type==='written_response');
const deterministicReady=Number(objectiveBundle.pipeline_validation?.ready);
const fallback=objectiveBundle.ai_objective_fallback;
const identity=source=>[source?.exam,source?.section,source?.source_question_no].join('::');
const evidenceByIdentity=new Map((evidenceBundle.questions||[]).filter(question=>question.type==='multiple_choice'&&question.payload?.import_status==='drop').map(question=>[identity(question.payload?.source),question.payload?._raw_question_text||'']));
const normalize=value=>String(value||'').normalize('NFKC').replace(/[ⓐ-ⓕ]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const compact=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const plainTaxonomies=new Set(['topic','title','main_idea','purpose','emotion','content_true','content_false','unanswerable']);
const tokens=value=>(compact(value).toLowerCase().replace(/\([A-H]\)\s*\[[^\]]+\]/g,' ').replace(/[ⓐ-ⓩ㉠-㉭]/g,' ').match(/[a-z]+(?:['’][a-z]+)?/g)||[]);
const similarity=(left,right)=>{const a=new Set(tokens(left)),b=new Set(tokens(right));if(!a.size||!b.size)return 0;let common=0;for(const word of a)if(b.has(word))common+=1;return common/Math.max(a.size,b.size);};
const sentences=value=>compact(value).match(/[^.!?]+(?:[.!?]+|$)/g)?.map(item=>compact(item)).filter(Boolean)||[];
function canonicalPlainExcerpt(raw,canonical){
  const source=sentences(raw),rows=sentences(canonical);if(!source.length||!rows.length)return '';
  const hits=[];let cursor=0;
  for(const sentence of source){let best={index:-1,score:0};for(let index=cursor;index<rows.length;index+=1){const score=similarity(sentence,rows[index]);if(score>best.score)best={index,score};if(score>.96)break;}if(best.index<0||best.score<.52)return '';hits.push(best.index);cursor=best.index+1;}
  if(new Set(hits).size!==hits.length)return '';
  return rows.slice(hits[0],hits[hits.length-1]+1).join(' ');
}
const lessonByPassage=new Map((objectiveBundle.lessons||[]).map((lesson,index)=>[index+1,(lesson.rows||[]).map(row=>row.text).join(' ')]));
if(objectiveSource.length!==131)throw new Error(`Expected 131 objective source questions, found ${objectiveSource.length}.`);
if(writtenSource.length!==26)throw new Error(`Expected the accepted 26 written questions, found ${writtenSource.length}.`);
if(deterministicReady!==88)throw new Error(`Deterministic objective baseline changed: ${deterministicReady}.`);
if(fallback?.engine!=='codex-cli'||Number(fallback.attempted)!==43)throw new Error('Objective fallback must be one Codex pass over exactly 43 deterministic drops.');

const objectiveReport=[],objectiveReady=[];
for(const question of objectiveSource){
  const payload=question.payload||{};
  delete payload._raw_question_text;
  if(plainTaxonomies.has(payload.taxonomy)){
    const canonical=lessonByPassage.get(Number(payload.source?.passage_no))||'';
    const repaired=canonicalPlainExcerpt(payload.set_text||payload.variant_text,canonical);
    if(repaired){payload.set_text=repaired;payload.variant_text=repaired;payload.variant_mode='canonical_overlay';}
  }
  buildObjectiveSourceContract(payload);
  const validation=validateQuestionSpec(payload,question.type,'available');
  const errors=[...validation.errors],rawEvidence=evidenceByIdentity.get(identity(payload.source));
  if(rawEvidence&&!normalize(rawEvidence).includes(normalize(payload.set_text||payload.variant_text))&&similarity(rawEvidence,payload.set_text||payload.variant_text)<.72)errors.push('AI student passage exceeds raw PDF question evidence');
  const ready=payload.import_status==='ready'&&!errors.length;
  payload.import_status=ready?'ready':'drop';
  if(payload.spec)payload.spec.importStatus=payload.import_status;
  question.status=ready?'available':'draft';
  objectiveReport.push({source:payload.source,status:ready?'ready':'drop',errors:[...new Set(errors)]});
  if(ready)objectiveReady.push(question);
}
const writtenReport=[];
for(const question of writtenSource){
  const payload=question.payload||{};
  delete payload._raw_question_text;
  const guide=payload.writing_guide||{};
  buildStructuredSourceContract({payload,structured:{passage_text:payload.set_text||payload.variant_text,task_text:guide.task_text||'',conditions:guide.conditions||[],word_bank:guide.word_bank||[],summary_text:payload.summary_text||'',targets:payload.target_ranges||guide.targets||[],response_slots:payload.response_slots||[]},sourceFileHash:payload.pipeline_contract?.document_sha256||payload.source?.document_sha256,page:payload.source?.page||null,bbox:payload.source?.bbox||null});
  const validation=validateQuestionSpec(payload,question.type,'available');
  if(payload.import_status!=='ready'||validation.errors.length)throw new Error(`Accepted written question failed final validation: ${payload.source?.exam} #${payload.source?.source_question_no}: ${validation.errors.join(', ')}`);
  question.status='available';
  writtenReport.push({source:payload.source,status:'ready',errors:[]});
}

const objectiveDropped=131-objectiveReady.length;
const finalByIdentity=new Map(objectiveReport.map(item=>[identity(item.source),item]));
const fallbackIdentities=new Set((fallback.report||[]).map(item=>identity(item.source)));
const finalRecovered=objectiveReport.filter(item=>item.status==='ready'&&fallbackIdentities.has(identity(item.source))).length;
const deterministicRetained=objectiveReady.length-finalRecovered;
const finalFallback={...fallback,structured_candidates:Number(fallback.recovered),recovered:finalRecovered,dropped:43-finalRecovered,report:(fallback.report||[]).map(item=>{const final=finalByIdentity.get(identity(item.source));return {...item,structure_status:item.status,structure_errors:item.errors,status:final?.status||'drop',errors:final?.errors||['final objective validation record missing']};})};
const bundle={
  lessons:objectiveBundle.lessons||writtenBundle.lessons||[],
  questions:[...objectiveReady,...writtenSource],
  ai_written_structure:writtenBundle.ai_written_structure,
  ai_objective_fallback:finalFallback,
  pipeline_validation:{
    generated_at:new Date().toISOString(),
    version:2,
    objective:{source:131,deterministic_ready:deterministicReady,deterministic_retained:deterministicRetained,ai_attempted:43,ai_recovered:finalRecovered,ready:objectiveReady.length,dropped:objectiveDropped,report:objectiveReport.filter(item=>item.status==='drop')},
    written:{source:29,ready:26,dropped:3,report:(writtenBundle.pipeline_validation?.report||[]).filter(item=>item.type==='written_response'&&item.status==='drop')},
  },
};
writeFileSync(resolve(output),`${JSON.stringify(bundle,null,2)}\n`);
console.log(JSON.stringify({objective:bundle.pipeline_validation.objective,written:{source:29,ready:26,dropped:3},total_ready:bundle.questions.length},null,2));
