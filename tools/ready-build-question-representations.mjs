#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {buildQuestionRepresentation,classifyBodyQuestion,questionRepresentationErrors} from '../server/ready/question-representation.mjs';

const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:'';};
const input=value('--input'),output=value('--output');
if(!input||!output)throw new Error('Usage: node tools/ready-build-question-representations.mjs --input <private-extraction.json> --output <private-representations.json>');
const source=JSON.parse(await readFile(input,'utf8')),passageId=String(source?.canonical?.passage_id||''),canonicalText=String(source?.canonical?.text||''),questions=Array.isArray(source?.questions)?source.questions:[];
if(!passageId||!canonicalText||!questions.length)throw new Error('Input requires canonical.passage_id, canonical.text, and questions.');
const representations=[],report=[];
for(const question of questions){
  const classification=classifyBodyQuestion(question,canonicalText);
  if(!classification.body_question){report.push({source_question_no:question.source_question_no,body_question:false,exclusion_reason:classification.exclusion_reason,alignments:classification.alignments});continue;}
  const representation=buildQuestionRepresentation(question,{passageId,canonicalText}),errors=questionRepresentationErrors(representation,{canonicalByPassage:{[passageId]:canonicalText}});
  representations.push(representation);
  report.push({source_question_no:question.source_question_no,body_question:true,status:errors.length?'qa':'ready',errors,source_blocks:representation.source_blocks.map(block=>({id:block.id,kind:block.kind,role:block.role,alignment:block.alignment})),pointers:representation.pointers.map(pointer=>({id:pointer.id,label:pointer.label,block_id:pointer.block_id,start:pointer.start,end:pointer.end,kind:pointer.kind,confidence:pointer.confidence,evidence:pointer.evidence})),response_type:representation.response.type,answer_linked:representation.answer.source==='publisher_answer_key'});
}
const result={document:source.document,canonical:{passage_id:passageId},representation_version:1,source_questions:questions.length,body_questions:report.filter(item=>item.body_question).length,ready:report.filter(item=>item.status==='ready').length,qa:report.filter(item=>item.status==='qa').length,excluded:report.filter(item=>!item.body_question).length,representations,report};
await writeFile(output,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify({output,source:result.source_questions,body:result.body_questions,ready:result.ready,qa:result.qa,excluded:result.excluded},null,2));
