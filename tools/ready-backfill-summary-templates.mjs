#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { compileInteractionContract } from './ready-interaction-contract.mjs';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';

const apply=process.argv.includes('--apply');
function query(sql){
  const run=spawnSync('npx',['supabase','db','query','--linked','--output','json',sql],{encoding:'utf8',maxBuffer:32*1024*1024});
  if(run.status!==0)throw new Error(run.stderr||run.stdout||`supabase exited ${run.status}`);
  return JSON.parse(run.stdout).rows||[];
}

const rows=query("select id,type,status,payload from public.ready_questions where type='written_response' and status='available' and replace(coalesce(payload->'writing_guide'->>'kind',''),'-','_')='summary' order by created_at");
const updates=[],drops=[],report=[];
for(const row of rows){
  const payload=structuredClone(row.payload),source=payload.source||{};
  let errors=[];
  try{compileInteractionContract(payload,'written_response');errors=validateQuestionSpec(payload,'written_response','available').errors;}catch(error){errors=[error.message||String(error)];}
  const ready=!errors.length;
  report.push({id:row.id,exam:source.exam,question:source.source_question_no,slots:payload.response_slots?.length||0,word_counts:(payload.response_slots||[]).map(slot=>slot.word_count),ready,errors});
  if(ready)updates.push({id:row.id,payload});else drops.push(row.id);
}

if(apply&&(updates.length||drops.length)){
  const statements=[
    ...updates.map(item=>`update public.ready_questions set payload='${JSON.stringify(item.payload).replaceAll("'","''")}'::jsonb,updated_at=now() where id='${item.id}'::uuid;`),
    ...drops.map(id=>`update public.ready_questions set status='draft',payload=jsonb_set(jsonb_set(payload,'{import_status}','\"drop\"'::jsonb,true),'{spec,importStatus}','\"drop\"'::jsonb,true),updated_at=now() where id='${id}'::uuid;`),
  ].join('\n');
  query(`begin;\n${statements}\ncommit;`);
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',matched:report.length,ready:updates.length,dropped:drops.length,report},null,2));
