#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildObjectiveSourceContract } from './ready-source-contract.mjs';
import { compileInteractionContract } from './ready-interaction-contract.mjs';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';

const apply=process.argv.includes('--apply');
const circled=['①','②','③','④','⑤','⑥','⑦','⑧'];
const text=value=>String(value||'').trim();
const list=value=>Array.isArray(value)?value:[];
const desktop='/Users/kosangbum/Desktop';
const pdfPython=process.env.READY_PDF_PYTHON||'/Users/kosangbum/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';

function query(sql){
  const run=spawnSync('npx',['supabase','db','query','--linked','--output','json',sql],{encoding:'utf8',maxBuffer:64*1024*1024});
  if(run.status!==0)throw new Error(run.stderr||run.stdout||`supabase exited ${run.status}`);
  return JSON.parse(run.stdout).rows||[];
}

function mapped(value){
  const input=String(value||'').normalize('NFC'),chars=[],map=[];
  let spaced=false;
  for(let index=0;index<input.length;index+=1){
    let char=input[index].replace(/[’‘]/g,"'").replace(/[“”]/g,'"');
    if(/\s/.test(char)){if(spaced)continue;char=' ';spaced=true;}else spaced=false;
    chars.push(char.toLowerCase());map.push(index);
  }
  return {value:chars.join('').trim(),map,input};
}

function missingSpanFrame(variant,canonical){
  const shown=mapped(variant),source=mapped(canonical);
  if(!shown.value||!source.value)return null;
  let sourceStart=-1;
  for(let size=Math.min(100,shown.value.length);size>=24&&sourceStart<0;size-=4)sourceStart=source.value.indexOf(shown.value.slice(0,size));
  if(sourceStart<0)return null;
  let shownIndex=0,sourceIndex=sourceStart;
  while(shownIndex<shown.value.length&&sourceIndex<source.value.length&&shown.value[shownIndex]===source.value[sourceIndex]){shownIndex+=1;sourceIndex+=1;}
  if(shownIndex>=shown.value.length)return null;
  let resumeSource=-1;
  for(let size=Math.min(100,shown.value.length-shownIndex);size>=24&&resumeSource<0;size-=4)resumeSource=source.value.indexOf(shown.value.slice(shownIndex,shownIndex+size),sourceIndex+1);
  if(resumeSource<=sourceIndex)return null;
  const omitted=source.value.slice(sourceIndex,resumeSource).trim();
  if(!omitted||omitted.split(/\s+/).length>24)return null;
  const insertion=shown.map[shownIndex]??shown.input.length;
  return `${shown.input.slice(0,insertion).trimEnd()} _____ ${shown.input.slice(insertion).trimStart()}`.replace(/\s+([,.;!?])/g,'$1').replace(/\s+/g,' ').trim();
}

function repairBlank(payload,canonical){
  if(!text(payload.taxonomy).startsWith('blank_')||/[_＿]{3,}/.test(text(payload.set_text)))return false;
  const frame=missingSpanFrame(payload.set_text,canonical);
  if(!frame)return false;
  payload.set_text=frame;payload.variant_text=frame;
  return true;
}

function repairReference(payload){
  if(!/가리키는 대상|지칭/.test(text(payload.prompt)))return false;
  const ranges=[];
  for(const match of String(payload.set_text||'').matchAll(/([①-⑧])\s+([A-Za-z]+(?:['’][A-Za-z]+)?)/g))ranges.push({label:match[1],text:match[2],canonical_text:match[2],kind:'target'});
  if(ranges.length!==list(payload.choices).length||ranges.length<2)return false;
  payload.taxonomy='reference';payload.target_ranges=ranges;
  payload.spec.renderer='annotated_passage_mcq';
  return true;
}

function normalizedWords(value){
  return String(value||'').normalize('NFC').replace(/[’‘]/g,"'").replace(/[“”]/g,'"').replace(/[^A-Za-z0-9가-힣']+/g,' ').trim().toLowerCase();
}

function loadPublisherUnderlines(rows){
  const maps=new Map();
  for(const sourceFile of new Set(rows.map(row=>text(row.payload?.source?.source_file)).filter(Boolean))){
    const pdf=join(desktop,sourceFile);
    if(!existsSync(pdf))continue;
    const run=spawnSync(pdfPython,['tools/ready-pdf-underlines.py',pdf],{encoding:'utf8',maxBuffer:64*1024*1024});
    if(run.status!==0)throw new Error(run.stderr||`underline extraction failed for ${sourceFile}`);
    maps.set(sourceFile,JSON.parse(run.stdout));
  }
  return maps;
}

function repairPublisherUnderlines(payload,underlineMaps){
  if(payload.source?.provider!=='nernter'||!/밑줄\s*친/.test(text(payload.prompt)))return false;
  const sourceFile=text(payload.source?.source_file),page=Number(payload.source?.page),question=Number(payload.source?.source_question_no);
  const geometry=list(underlineMaps.get(sourceFile)?.[`${page}:${question}`]);
  if(!geometry.length)return false;
  const body=String(payload.set_text||''),markers=[...body.matchAll(/([①-⑧ⓐ-ⓩ])\s*/g)];
  if(markers.length<2)return false;
  const ranges=[];let geometryIndex=0;
  for(let index=0;index<markers.length;index+=1){
    const marker=markers[index],following=body.slice((marker.index||0)+marker[0].length,markers[index+1]?.index??body.length);
    const prefix=normalizedWords(following);
    let found=-1;
    for(let candidate=geometryIndex;candidate<geometry.length;candidate+=1){
      const underlined=normalizedWords(geometry[candidate]?.text);
      if(underlined&&prefix.startsWith(underlined)){found=candidate;break;}
    }
    if(found<0)return false;
    const underlined=text(geometry[found].text).replace(/[.,;:!?]+$/,'');
    if(!underlined||!body.includes(underlined))return false;
    ranges.push({label:marker[1],text:underlined,canonical_text:underlined,kind:'target'});
    geometryIndex=found+1;
  }
  if(ranges.length!==markers.length)return false;
  payload.target_ranges=ranges;
  if(/가리키는 대상|지칭/.test(text(payload.prompt)))payload.taxonomy='reference';
  payload.spec.renderer='annotated_passage_mcq';
  return true;
}

function repairEmbeddedChoices(payload){
  const choices=list(payload.choices).map(text);
  if(!/내용과 일치/.test(text(payload.prompt))||!choices.length||!choices.every((choice,index)=>choice===String(index+1)))return false;
  const source=String(payload.set_text||''),matches=[...source.matchAll(/[①②③④⑤⑥⑦⑧]/g)];
  if(matches.length!==choices.length)return false;
  const promoted=matches.map((match,index)=>source.slice((match.index||0)+match[0].length,matches[index+1]?.index??source.length).trim()).map(value=>value.replace(/^\s+|\s+$/g,''));
  if(promoted.some(value=>value.length<12))return false;
  payload.set_text=source.slice(0,matches[0].index).trim();payload.variant_text=payload.set_text;payload.choices=promoted;
  return true;
}

const rows=query("select q.id,q.type,q.status,q.payload,p.source_text canonical from public.ready_questions q join public.ready_passages p on p.id=q.passage_id where q.status='available' and q.type in ('multiple_choice','written_response') order by q.created_at");
const underlineMaps=loadPublisherUnderlines(rows);
const updates=[],drops=[],report=[];
for(const row of rows){
  const payload=structuredClone(row.payload),repairs=[];
  if(row.type==='multiple_choice'){
    if(repairPublisherUnderlines(payload,underlineMaps))repairs.push('publisher_underlines');
    else if(payload.source?.provider!=='nernter'&&repairReference(payload))repairs.push('reference_spans');
    if(repairEmbeddedChoices(payload))repairs.push('embedded_choices');
    if(repairBlank(payload,row.canonical))repairs.push('blank_frame');
    if(repairs.length)buildObjectiveSourceContract(payload);
  }
  let errors=[];
  try{compileInteractionContract(payload,row.type);errors=validateQuestionSpec(payload,row.type,'available').errors;}catch(error){errors=[error.message||String(error)];}
  const ready=!errors.length;
  report.push({id:row.id,exam:payload.source?.exam,question:payload.source?.source_question_no,type:row.type,taxonomy:payload.taxonomy,repairs,status:ready?'ready':'drop',errors});
  if(ready)updates.push({id:row.id,payload});else drops.push(row.id);
}

if(apply&&(updates.length||drops.length)){
  const statements=[
    ...updates.map(item=>`update public.ready_questions set payload='${JSON.stringify(item.payload).replaceAll("'","''")}'::jsonb,updated_at=now() where id='${item.id}'::uuid;`),
    ...drops.map(id=>`update public.ready_questions set status='draft',payload=jsonb_set(jsonb_set(payload,'{import_status}','"drop"'::jsonb,true),'{spec,importStatus}','"drop"'::jsonb,true),updated_at=now() where id='${id}'::uuid;`),
  ];
  for(let index=0;index<statements.length;index+=12)query(`begin;\n${statements.slice(index,index+12).join('\n')}\ncommit;`);
}

const reasons={};for(const item of report.filter(item=>item.status==='drop'))for(const error of item.errors)reasons[error]=(reasons[error]||0)+1;
console.log(JSON.stringify({mode:apply?'apply':'dry-run',source:rows.length,ready:updates.length,dropped:drops.length,repairs:report.reduce((out,item)=>{for(const repair of item.repairs)out[repair]=(out[repair]||0)+1;return out;},{}),drop_reasons:reasons,report},null,2));
