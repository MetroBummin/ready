#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';
import { buildObjectiveSourceContract } from './ready-source-contract.mjs';
import { applyAnswerKeyWordCounts } from './ready-written-contract.mjs';

const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:'';};
const input=value('--input'),output=value('--output'),samples=value('--samples'),full=args.includes('--full'),typeFilter=value('--type');
if(!input)throw new Error('Usage: node tools/ready-validate-pipeline.mjs --input bundle.json [--output bundle.json] [--samples fixtures.json | --full]');
const bundle=JSON.parse(readFileSync(resolve(input),'utf8')),questions=Array.isArray(bundle)?bundle:bundle.questions;
if(!Array.isArray(questions))throw new Error('Question bundle is missing.');
const sampleRows=samples?JSON.parse(readFileSync(resolve(samples),'utf8')):[],sampleKeys=new Set(sampleRows.map(item=>`${item.exam}::${Number(item.question)}`));
const selected=questions.filter(question=>(!typeFilter||question.type===typeFilter)&&(!samples||sampleKeys.has(`${question.payload?.source?.exam}::${Number(question.payload?.source?.source_question_no)}`)));
if(samples&&selected.length!==sampleKeys.size)throw new Error(`Representative fixture gate matched ${selected.length}/${sampleKeys.size}.`);
const report=[];
for(const question of selected){
  const payload=question.payload||{};
  if(question.type==='multiple_choice')buildObjectiveSourceContract(payload);
  if(question.type==='written_response')payload.response_slots=applyAnswerKeyWordCounts(payload,{response_slots:payload.response_slots}).response_slots;
  const validation=validateQuestionSpec(payload,question.type,question.status||'available'),errors=[...validation.errors];
  if(Number(payload.pipeline_contract?.version)!==2)errors.push('block-first pipeline contract v2 is missing');
  const ready=!errors.length;
  payload.import_status=ready?'ready':'drop';if(payload.spec)payload.spec.importStatus=payload.import_status;question.status=ready?'available':'draft';
  report.push({source:payload.source,type:question.type,status:ready?'ready':'drop',errors:[...new Set(errors)]});
}
const ready=report.filter(item=>item.status==='ready').length,dropped=report.length-ready;
if(full&&!Array.isArray(bundle))bundle.questions=questions.filter(question=>question.payload?.import_status==='ready');
if(!Array.isArray(bundle))bundle.pipeline_validation={generated_at:new Date().toISOString(),mode:full?'full':samples?'samples':'check',processed:report.length,ready,dropped,report};
if(output)writeFileSync(resolve(output),`${JSON.stringify(bundle,null,2)}\n`);
console.log(JSON.stringify({processed:report.length,ready,dropped,reasons:Object.entries(report.flatMap(item=>item.errors).reduce((out,error)=>(out[error]=(out[error]||0)+1,out),{})).sort((a,b)=>b[1]-a[1])},null,2));
if(samples&&dropped)process.exitCode=1;
