#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';
import { buildObjectiveSourceContract } from './ready-source-contract.mjs';
import { applyAnswerKeyWordCounts } from './ready-written-contract.mjs';
import { compileAndValidateInteraction } from './ready-interaction-contract.mjs';
import { contractChoiceCopyHtml, contractPassageHtml, contractRenderCounts, contractResponseControlHtml } from '../ready/interaction-runtime.js';

const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:'';};
const input=value('--input'),output=value('--output'),samples=value('--samples'),full=args.includes('--full'),typeFilter=value('--type');
if(!input)throw new Error('Usage: node tools/ready-validate-pipeline.mjs --input bundle.json [--output bundle.json] [--samples fixtures.json | --full]');
const bundle=JSON.parse(readFileSync(resolve(input),'utf8')),questions=Array.isArray(bundle)?bundle:bundle.questions;
if(!Array.isArray(questions))throw new Error('Question bundle is missing.');
const sampleRows=samples?JSON.parse(readFileSync(resolve(samples),'utf8')):[],sampleKeys=new Set(sampleRows.map(item=>`${item.exam}::${Number(item.question)}`));
const selected=questions.filter(question=>(!typeFilter||question.type===typeFilter)&&(!samples||sampleKeys.has(`${question.payload?.source?.exam}::${Number(question.payload?.source?.source_question_no)}`)));
if(samples&&selected.length!==sampleKeys.size)throw new Error(`Representative fixture gate matched ${selected.length}/${sampleKeys.size}.`);
const report=[];
const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]));
function actualRenderErrors(payload,type){
  const contract=payload?.spec?.interaction,errors=[];
  if(!contract)return ['actual renderer has no interaction contract'];
  const counts=contractRenderCounts(contract),passage=contractPassageHtml(contract,{escape});
  const devices=(passage.match(/data-contract-device=/g)||[]).length;
  if(contract.passage.visible&&devices!==counts.passageDevices)errors.push('actual passage renderer lost an interaction device');
  if(!contract.passage.visible&&passage)errors.push('hidden passage was rendered');
  for(let index=0;index<counts.choiceRows;index+=1){
    const copy=contractChoiceCopyHtml(contract,index,escape);
    if(!copy)errors.push(`actual choice renderer produced an empty row ${index+1}`);
    if(contract.kind==='choice_matrix'&&(copy.match(/data-choice-column=/g)||[]).length!==contract.choices.columns.length)errors.push(`actual choice renderer lost matrix cells in row ${index+1}`);
  }
  if(type==='written_response')for(let index=0;index<counts.responseSlots;index+=1)if(!contractResponseControlHtml(contract,index,{escape,value:'publisher-answer'}).includes(`data-written-slot="${index}"`))errors.push(`actual response renderer lost slot ${index+1}`);
  return [...new Set(errors)];
}
for(const question of selected){
  const payload=question.payload||{};
  if(question.type==='multiple_choice')buildObjectiveSourceContract(payload);
  if(question.type==='written_response')payload.response_slots=applyAnswerKeyWordCounts(payload,{response_slots:payload.response_slots}).response_slots;
  const interactionErrors=compileAndValidateInteraction(payload,question.type),renderErrors=interactionErrors.length?[]:actualRenderErrors(payload,question.type);
  const validation=validateQuestionSpec(payload,question.type,question.status||'available'),errors=[...interactionErrors,...validation.errors];
  errors.push(...renderErrors);
  if(Number(payload.pipeline_contract?.version)!==2)errors.push('block-first pipeline contract v2 is missing');
  const ready=!errors.length;
  payload.import_status=ready?'ready':'drop';if(payload.spec)payload.spec.importStatus=payload.import_status;question.status=ready?'available':'draft';
  report.push({source:payload.source,type:question.type,status:ready?'ready':'drop',round_trip:ready?'pass':'drop',errors:[...new Set(errors)]});
}
const ready=report.filter(item=>item.status==='ready').length,dropped=report.length-ready;
if(full&&!Array.isArray(bundle))bundle.questions=questions.filter(question=>question.payload?.import_status==='ready');
if(!Array.isArray(bundle))bundle.pipeline_validation={...(bundle.pipeline_validation||{}),generated_at:new Date().toISOString(),mode:full?'full':samples?'samples':'check',processed:report.length,ready,dropped,interaction_contract:{version:1,source:report.length,ready,dropped,actual_render_passed:ready,publisher_grade_round_trip_passed:ready},report};
if(output)writeFileSync(resolve(output),`${JSON.stringify(bundle,null,2)}\n`);
console.log(JSON.stringify({processed:report.length,ready,dropped,reasons:Object.entries(report.flatMap(item=>item.errors).reduce((out,error)=>(out[error]=(out[error]||0)+1,out),{})).sort((a,b)=>b[1]-a[1])},null,2));
if(samples&&dropped)process.exitCode=1;
