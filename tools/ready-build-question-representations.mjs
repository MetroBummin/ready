#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {buildQuestionRepresentation,classifyBodyQuestion,questionRepresentationErrors} from '../server/ready/question-representation.mjs';
import {applyPublisherUnderlineGeometry} from '../server/ready/pointer-geometry.mjs';

const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:'';};
const input=value('--input'),output=value('--output');
if(!input||!output)throw new Error('Usage: node tools/ready-build-question-representations.mjs --input <private-extraction.json> --output <private-representations.json>');
const source=JSON.parse(await readFile(input,'utf8')),passageId=String(source?.canonical?.passage_id||''),canonicalText=String(source?.canonical?.text||''),questions=Array.isArray(source?.questions)?source.questions:[];
if(!passageId||!canonicalText||!questions.length)throw new Error('Input requires canonical.passage_id, canonical.text, and questions.');
let underlineGeometry={},underlineGeometryWarning='';
const pdfPath=String(source?.document?.path||'');
if(pdfPath&&existsSync(pdfPath)){
  const python=process.env.READY_PDF_PYTHON||'python3';
  const run=spawnSync(python,['tools/ready-pdf-underlines.py',pdfPath],{encoding:'utf8',maxBuffer:64*1024*1024});
  if(run.status===0)underlineGeometry=JSON.parse(run.stdout);
  else underlineGeometryWarning=String(run.stderr||run.error?.message||`Publisher underline extraction failed for ${pdfPath}`).trim();
}
const representations=[],report=[];
for(const rawQuestion of questions){
  const pointerResolution=applyPublisherUnderlineGeometry(rawQuestion,underlineGeometry),question=pointerResolution.question;
  const classification=classifyBodyQuestion(question,canonicalText);
  if(!classification.body_question){report.push({source_question_no:question.source_question_no,body_question:false,exclusion_reason:classification.exclusion_reason,alignments:classification.alignments});continue;}
  const representation=buildQuestionRepresentation(question,{passageId,canonicalText}),errors=questionRepresentationErrors(representation,{canonicalByPassage:{[passageId]:canonicalText}});
  representations.push(representation);
  report.push({source_question_no:question.source_question_no,body_question:true,status:errors.length?'qa':'ready',errors,pointer_resolution:pointerResolution.mode,pointer_geometry_page:pointerResolution.page||null,source_blocks:representation.source_blocks.map(block=>({id:block.id,kind:block.kind,role:block.role,alignment:block.alignment})),pointers:representation.pointers.map(pointer=>({id:pointer.id,label:pointer.label,block_id:pointer.block_id,start:pointer.start,end:pointer.end,kind:pointer.kind,extracted_text:pointer.extracted_text,confidence:pointer.confidence,evidence:pointer.evidence})),response_type:representation.response.type,answer_linked:representation.answer.source==='publisher_answer_key'});
}
const result={document:{...source.document,underline_geometry_warning:underlineGeometryWarning||null},canonical:{passage_id:passageId},representation_version:1,source_questions:questions.length,body_questions:report.filter(item=>item.body_question).length,ready:report.filter(item=>item.status==='ready').length,qa:report.filter(item=>item.status==='qa').length,excluded:report.filter(item=>!item.body_question).length,representations,report};
await writeFile(output,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify({output,source:result.source_questions,body:result.body_questions,ready:result.ready,qa:result.qa,excluded:result.excluded},null,2));
