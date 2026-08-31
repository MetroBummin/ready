#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { applyGuidedClozeContract } from './ready-guided-cloze.mjs';
import { buildStructuredSourceContract } from './ready-source-contract.mjs';
import { compileInteractionContract } from './ready-interaction-contract.mjs';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';

const apply=process.argv.includes('--apply');
function query(sql){
  const run=spawnSync('npx',['supabase','db','query','--linked','--output','json',sql],{encoding:'utf8',maxBuffer:32*1024*1024});
  if(run.status!==0)throw new Error(run.stderr||run.stdout||`supabase exited ${run.status}`);
  return JSON.parse(run.stdout).rows||[];
}

const rows=query("select id,type,status,payload from public.ready_questions where type='written_response' and status='available' order by created_at");
const updates=[],report=[];
for(const row of rows){
  const payload=structuredClone(row.payload),source=payload.source||{},before=payload.accepted_answers?.[0]?.[0]||'';
  if(!applyGuidedClozeContract(payload))continue;
  buildStructuredSourceContract({payload,structured:{passage_text:payload.set_text||payload.variant_text||payload.passage_text,task_text:payload.writing_guide?.task_text||'',conditions:payload.writing_guide?.conditions||[],word_bank:payload.writing_guide?.word_bank||[],summary_text:payload.summary_text||'',targets:payload.writing_guide?.targets||[],response_slots:payload.response_slots},sourceFileHash:source.document_sha256,page:source.page,bbox:source.bbox});
  compileInteractionContract(payload,'written_response');
  const validation=validateQuestionSpec(payload,'written_response','available');
  report.push({id:row.id,exam:source.exam,question:source.source_question_no,slots:payload.response_slots.length,ready:validation.ready,errors:validation.errors});
  if(!validation.ready)continue;
  if(payload.writing_guide.publisher_answer!==before)throw new Error(`publisher answer changed for ${row.id}`);
  updates.push({id:row.id,payload});
}

if(apply&&updates.length){
  const statements=updates.map(item=>`update public.ready_questions set payload='${JSON.stringify(item.payload).replaceAll("'","''")}'::jsonb,updated_at=now() where id='${item.id}'::uuid;`).join('\n');
  query(`begin;\n${statements}\ncommit;`);
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',matched:report.length,updated:apply?updates.length:0,report},null,2));
