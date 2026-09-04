import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {alignPublisherText,classifyBodyQuestion,projectQuestionRepresentation,publicQuestionRepresentation,questionRepresentationErrors,questionRepresentationPayloadErrors} from '../server/ready/question-representation.mjs';
import {validateQuestionSpec} from '../server/ready/question-spec.mjs';
import {BANK_CANONICAL_PASSAGE,TARGET_PASSAGE_ID} from './fixtures/question-reference-bank.mjs';
import {CALIBRATION_BODY_PROBES} from './fixtures/question-representation-calibration.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const docs=readFileSync(resolve(root,'ready/QUESTION_REPRESENTATION.md'),'utf8');
const importer=readFileSync(resolve(root,'tools/ready-import-questions.mjs'),'utf8');
const canonical='Alpha choices guide people gently. Beta defaults preserve freedom.';
const start=canonical.indexOf('Alpha'),end=canonical.indexOf(' Beta');
const base={
  version:1,independent_prompt_count:1,
  source_blocks:[{id:'main',kind:'canonical_span',role:'main',passage_id:'passage-1',start,end,canonical_text:canonical.slice(start,end),display_text:canonical.slice(start,end)}],
  prompt:'윗글의 내용으로 알맞은 것은?',pointers:[],
  response:{type:'single_choice',choices:['Alpha is gentle.','Alpha forbids every option.'],constraints:{}},
  answer:{source:'publisher_answer_key',indexes:[0]},explanation:{source:'publisher_explanation',text:'Alpha is described as gentle.'},
};
assert.deepEqual(questionRepresentationErrors(base,{canonicalByPassage:{'passage-1':canonical}}),[]);
assert.match(docs,/source_blocks \+ prompt \+ pointers \+ response \+ answer\/explanation/);
assert.match(importer,/invalid semantic representation/);

const fallback=alignPublisherText('A publisher-only Korean summary with unrelated content.',canonical);
assert.equal(fallback.mode,'publisher_text');
const exact=alignPublisherText(canonical.slice(start,end),canonical,{passageId:'passage-1'});
assert.equal(exact.mode,'canonical_span');
const mutation={...base,source_blocks:[{...base.source_blocks[0],display_text:'Alpha choices guides people gently.',mutations:[{canonical:'guide',publisher:'guides'}]}]};
assert.deepEqual(questionRepresentationErrors(mutation,{canonicalByPassage:{'passage-1':canonical}}),[],'Local mutation must round-trip');

const multiBlocks={...base,source_blocks:[base.source_blocks[0],{id:'summary',kind:'publisher_text',role:'summary',text:'Alpha _____ people.'}]};
assert.deepEqual(questionRepresentationErrors(multiBlocks,{canonicalByPassage:{'passage-1':canonical}}),[],'Multiple source blocks and publisher fallback must be valid');
const blank={...multiBlocks,pointers:[{id:'blank-a',label:'(A)',block_id:'summary',start:6,end:6,kind:'blank',confidence:'high',evidence:'publisher underscore coordinates beside label (A)'}]};
assert.deepEqual(questionRepresentationErrors(blank,{canonicalByPassage:{'passage-1':canonical}}),[],'Blank pointers are zero-width');
const spanText=base.source_blocks[0].display_text,spanStart=spanText.indexOf('choices');
const spans={...base,pointers:[
  {id:'source-A',label:'(A)',block_id:'main',start:0,end:0,kind:'point',confidence:'high',evidence:'source block heading'},
  {id:'target-a',label:'ⓐ',block_id:'main',start:spanStart,end:spanStart+7,kind:'span',extracted_text:'choices',confidence:'high',evidence:'underline geometry and adjacent label'},
]};
assert.deepEqual(questionRepresentationErrors(spans,{canonicalByPassage:{'passage-1':canonical}}),[],'Source A and target ⓐ roles must not collide');

const written={...base,prompt:'ⓐ와 ⓑ를 각각 고쳐 쓰시오.',pointers:spans.pointers,response:{type:'written_text',slots:[{id:'a',label:'ⓐ'},{id:'b',label:'ⓑ'}],constraints:{word_count:[1,1]}},answer:{source:'publisher_answer_key',accepted_answers:[['choice'],['guides']]}};
assert.deepEqual(questionRepresentationErrors(written,{canonicalByPassage:{'passage-1':canonical}}),[],'Multi-slot written response and constraints must remain one Question');
assert(questionRepresentationErrors({...base,independent_prompt_count:2}).some(error=>error.includes('one independent prompt')));
assert(questionRepresentationErrors({...base,answer:{source:'model_inference',indexes:[0]}}).some(error=>error.includes('publisher answer key')));
const publicCopy=publicQuestionRepresentation(written);
assert(!('answer' in publicCopy)&&!('explanation' in publicCopy),'Pre-submit public representation must not leak private answer or explanation');

const bodyResults=CALIBRATION_BODY_PROBES.map(item=>({...item,...classifyBodyQuestion({source_blocks:[{text:item.text}]},BANK_CANONICAL_PASSAGE)}));
assert.deepEqual(bodyResults.filter(item=>item.body_question).map(item=>item.sourceQuestionNo),[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]);
assert.deepEqual(bodyResults.filter(item=>!item.body_question).map(item=>item.sourceQuestionNo),[1,2,19,20]);

const payload={prompt:base.prompt,choices:base.response.choices,answer:base.answer.indexes,explanation:base.explanation.text,representation:base};
assert.deepEqual(questionRepresentationPayloadErrors(payload,{canonicalByPassage:{'passage-1':canonical}}),[]);
const projected=projectQuestionRepresentation(base,{taxonomy:'content_true',source:{provider:'exam4you',exam:'fixture',passage_no:1,source_question_no:1,section:'body'}});
assert.deepEqual(validateQuestionSpec(projected,'multiple_choice','available').errors,[],'Generic semantic-to-runtime projection must validate');
assert.equal(TARGET_PASSAGE_ID,'741d6581-1f4c-4e1d-823c-6be85c62bf52');
console.log('READY semantic Question representation contract verified.');
