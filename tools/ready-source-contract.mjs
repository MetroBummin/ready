import { createHash } from 'node:crypto';
import { PIPELINE_CONTRACT_VERSION, QUESTION_BLOCK_WHITELISTS, sourceContractErrors } from '../server/ready/source-contract.mjs';

const compact=value=>String(value||'').normalize('NFC').replace(/\s+/g,' ').trim();
const list=value=>Array.isArray(value)?value:[];
export { PIPELINE_CONTRACT_VERSION, QUESTION_BLOCK_WHITELISTS, sourceContractErrors };

export function sourceBlockId(kind,sourceText,index=0){
  return `src_${createHash('sha256').update(`${kind}\0${compact(sourceText)}\0${index}`).digest('hex').slice(0,16)}`;
}

export function makeSourceBlock({kind,sourceText,page=null,bbox=null,language='none',index=0}){
  return {id:sourceBlockId(kind,sourceText,index),source_text:compact(sourceText),page:Number.isInteger(Number(page))&&Number(page)>0?Number(page):null,bbox:Array.isArray(bbox)&&bbox.length===4?bbox.map(Number):null,language,block_kind:kind};
}

export function buildStructuredSourceContract({payload,structured,sourceFileHash,page=null,bbox=null}){
  const blocks=[],refs={};
  const add=(kind,value,language,index=0)=>{
    const sourceText=compact(value);if(!sourceText)return;
    const block=makeSourceBlock({kind,sourceText,page,bbox,language,index});blocks.push(block);(refs[kind]||=[]).push(block.id);
  };
  add('passage',structured.passage_text,'en');
  add('prompt',payload.prompt,'ko');
  add('korean_target',structured.task_text,/^[\s\S]*[가-힣]/.test(structured.task_text)?'ko':'mixed');
  list(structured.conditions).forEach((value,index)=>add('condition',value,'mixed',index));
  list(structured.word_bank).forEach((value,index)=>add('word_bank',value,'en',index));
  add('summary',structured.summary_text,'en');
  list(structured.targets).forEach((value,index)=>add('annotation_source',value?.text,'en',index));
  list(structured.response_slots).forEach((value,index)=>add('answer_template',`${value?.label||`답 ${index+1}`} · ${value?.word_count??'free'} words`,'mixed',index));
  add('explanation',payload.explanation,'ko');
  const source=payload.source||{};
  payload.source_blocks=blocks;
  payload.content_blocks=blocks.filter(block=>block.block_kind==='passage').map(block=>({kind:'text',text:block.source_text,source_block_id:block.id}));
  payload.pipeline_contract={version:PIPELINE_CONTRACT_VERSION,document_sha256:sourceFileHash,source_question_identity:[source.exam,source.section,source.source_question_no].map(compact).join('::'),block_refs:refs};
  if(payload.spec){const annotations=list(payload.target_ranges||structured.targets).map(target=>({...target,kind:target?.kind||'target'}));payload.spec.passage={source:'blocks',annotations,deviceMode:annotations.length?'annotations':'plain'};payload.spec.blocks=payload.content_blocks;}
  return payload.pipeline_contract;
}

export function buildObjectiveSourceContract(payload={}){
  for(const target of list(payload.target_ranges)){
    const raw=compact(target?.label);
    if(/^[A-H]$/.test(raw))target.label=`(${raw})`;
  }
  const source=payload.source||{},page=source.page||null,bbox=source.bbox||null,blocks=[],refs={};
  const add=(kind,value,language,index=0)=>{const sourceText=compact(value);if(!sourceText)return;const block=makeSourceBlock({kind,sourceText,page,bbox,language,index});blocks.push(block);(refs[kind]||=[]).push(block.id);};
  const passage=compact(payload.set_text||payload.variant_text||payload.passage_text);
  add('passage',passage,'en');add('prompt',payload.prompt,'ko');
  list(payload.target_ranges).forEach((item,index)=>add('annotation_source',item?.text,'en',index));
  if(payload.stimulus)add('stimulus',payload.stimulus,'en');
  if(payload.summary_text)add('summary',payload.summary_text,'en');
  list(payload.choices).forEach((choice,index)=>add('choice',choice,'mixed',index));
  add('explanation',payload.explanation,'ko');
  payload.source_blocks=blocks;
  payload.content_blocks=blocks.filter(block=>block.block_kind==='passage').map(block=>({kind:'text',text:block.source_text,source_block_id:block.id}));
  payload.pipeline_contract={version:PIPELINE_CONTRACT_VERSION,document_sha256:source.document_sha256,source_question_identity:[source.exam,source.section,source.source_question_no].map(compact).join('::'),block_refs:refs};
  if(payload.spec){const annotations=list(payload.target_ranges).map(target=>({...target,kind:target?.kind||'target'}));payload.spec.passage={source:'blocks',annotations,deviceMode:annotations.length?'annotations':'plain'};payload.spec.blocks=payload.content_blocks;}
  return payload.pipeline_contract;
}
