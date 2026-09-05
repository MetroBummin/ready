import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {alignPublisherText,classifyBodyQuestion,projectQuestionRepresentation,publicQuestionRepresentation,questionRepresentationErrors,questionRepresentationPayloadErrors} from '../server/ready/question-representation.mjs';
import {validateQuestionSpec} from '../server/ready/question-spec.mjs';
import {questionPassageHtml,questionSummaryHtml} from '../ready/question-renderer.js';
import {BANK_CANONICAL_PASSAGE,TARGET_PASSAGE_ID} from './fixtures/question-reference-bank.mjs';
import {CALIBRATION_BODY_PROBES} from './fixtures/question-representation-calibration.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const identity=value=>String(value??'');
const segmentCopy=payload=>payload.spec.interaction.passage.segments.map(segment=>segment.kind==='blank'?'':segment.text).join('');
const annotationCopy=payload=>payload.spec.interaction.passage.segments.filter(segment=>segment.kind==='annotation').map(segment=>({label:segment.label,text:segment.text}));
const occurrences=(source,target)=>String(source).split(String(target)).length-1;
const publisherBlock=(id,role,value,label='')=>({id,kind:'publisher_text',role,label,text:value});
const pointer=(id,label,block,value,target)=>{const escaped=target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=/^[A-Za-z].*[A-Za-z]$/.test(target)?new RegExp(`\\b${escaped}\\b`).exec(value):null,start=match?.index??value.indexOf(target);return {id,label,block_id:block,start,end:start+target.length,kind:'span',extracted_text:target,confidence:'high',evidence:'publisher underline geometry and adjacent prompt label'};};
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

const referenceText='Many people match their behavior with that of the majority. Later, they added a smiley face and found that it neutralized the opposite effect.';
const reference={...base,source_blocks:[publisherBlock('reference-main','main',referenceText)],prompt:'밑줄 친 ⓐthat, ⓑit이 가리키는 것을 각각 쓰시오.',pointers:[pointer('reference-a','ⓐ','reference-main',referenceText,'that'),pointer('reference-b','ⓑ','reference-main',referenceText,'it')],response:{type:'written_text',slots:[{id:'a',label:'ⓐ'},{id:'b',label:'ⓑ'}],constraints:{kind:'short_answers',layout:'short_answers'}},answer:{source:'publisher_answer_key',accepted_answers:[['다수의 행동'],['웃는 얼굴 표시']]}};
const referencePayload=projectQuestionRepresentation(reference,{taxonomy:'reference'});
assert.deepEqual(annotationCopy(referencePayload),[{label:'ⓐ',text:'that'},{label:'ⓑ',text:'it'}],'Reference pointers must equal only the publisher-marked words');
assert.deepEqual(validateQuestionSpec(referencePayload,'written_response','available').errors,[]);
const changedOwnership=structuredClone(reference);
changedOwnership.answer.accepted_answers=[['answer changes must not move a pointer'],['another answer']];
changedOwnership.source_blocks[0].alignment={canonical_start:999,canonical_end:1999,mode:'local_mutation'};
assert.deepEqual(annotationCopy(projectQuestionRepresentation(changedOwnership,{taxonomy:'reference'})),annotationCopy(referencePayload),'Answer and canonical alignment must not redefine publisher pointer boundaries');

const correctionText='Those who has consumed more energy reduced their use. The lack of a reminder could cause the opposite effect.';
const correction={...base,source_blocks:[publisherBlock('correction-main','main',correctionText)],prompt:'밑줄 친 ⓐ, ⓑ를 각각 알맞게 고쳐 쓰시오. (단, 다른 단어를 추가하지 말 것)',pointers:[pointer('correction-a','ⓐ','correction-main',correctionText,'has consumed'),pointer('correction-b','ⓑ','correction-main',correctionText,'could cause')],response:{type:'written_text',slots:[{id:'a',label:'ⓐ'},{id:'b',label:'ⓑ'}],constraints:{kind:'multi_correction',layout:'multi_correction',conditions:['다른 단어를 추가하지 말 것']}},answer:{source:'publisher_answer_key',accepted_answers:[['had consumed'],['could have caused']]}};
const correctionPayload=projectQuestionRepresentation(correction,{taxonomy:'correction'});
assert.deepEqual(annotationCopy(correctionPayload),[{label:'ⓐ',text:'has consumed'},{label:'ⓑ',text:'could cause'}]);
assert.deepEqual(correctionPayload.accepted_answers,[['had consumed'],['could have caused']],'Answer replacements must remain separate from original pointer text');
assert.deepEqual(validateQuestionSpec(correctionPayload,'written_response','available').errors,[]);

const korean='운전자들은 교차로에서 더 조심스러운 상태가 되었고, 이는 사고를 줄이고 보행자의 안전을 향상시켰다';
const koreanWriting={...base,source_blocks:[publisherBlock('writing-before','english_before','As a result, '),publisherBlock('writing-insert','korean_insert',korean),publisherBlock('writing-after','english_after','. The idea has been well received elsewhere.')],prompt:'윗글의 밑줄 친 ㉠의 우리말을 조건에 맞게 영작하시오.',pointers:[pointer('writing-target','㉠','writing-insert',korean,korean)],response:{type:'written_text',slots:[{id:'answer',label:'㉠'}],constraints:{kind:'sentence',conditions:['be being을 사용할 것','계속적 용법의 which를 사용할 것','보기 표현을 필요에 따라 변형할 것','정확히 16단어로 쓸 것'],word_bank:['careful','reduce','elevate','accidents','the safety','at','pedestrians','intersections']}},answer:{source:'publisher_answer_key',accepted_answers:[['drivers were being more careful at intersections, which reduced accidents and elevated the safety of pedestrians']]}};
const koreanPayload=projectQuestionRepresentation(koreanWriting,{taxonomy:'guided_writing'});
assert.equal(segmentCopy(koreanPayload),`As a result, ${korean}. The idea has been well received elsewhere.`,'English-before, Korean insert, and English-after must stay inline and in publisher order');
assert.deepEqual(annotationCopy(koreanPayload),[{label:'㉠',text:korean}]);
assert.equal(koreanPayload.writing_guide.task_text,'','An inline Korean source block must not be repeated below the passage');
assert.equal(occurrences(segmentCopy(koreanPayload)+koreanPayload.writing_guide.task_text,korean),1);
assert.deepEqual(validateQuestionSpec(koreanPayload,'written_response','available').errors,[]);

const summaryText='Defaults nudge people toward more (A) _____ behavior because they tend to (B) _____ existing options.';
const summaryQuestion={...base,source_blocks:[base.source_blocks[0],publisherBlock('summary','summary',summaryText)],prompt:'다음 글을 요약할 때 빈칸 (A), (B)에 들어갈 말로 알맞은 것은?',pointers:[{id:'summary-a',label:'(A)',block_id:'summary',start:summaryText.indexOf('_____'),end:summaryText.indexOf('_____'),kind:'blank',confidence:'high',evidence:'publisher blank and label (A)'},{id:'summary-b',label:'(B)',block_id:'summary',start:summaryText.lastIndexOf('_____'),end:summaryText.lastIndexOf('_____'),kind:'blank',confidence:'high',evidence:'publisher blank and label (B)'}],response:{type:'single_choice',choices:['beneficial / reject','sustainable / adhere to','temporary / replace'],constraints:{}},answer:{source:'publisher_answer_key',indexes:[1]}};
const summaryPayload=projectQuestionRepresentation(summaryQuestion,{taxonomy:'summary_two_blank'});
assert(!segmentCopy(summaryPayload).includes(summaryText),'Summary belongs to the summary surface, not the passage surface');
const summaryQuestionView={interactionContract:summaryPayload.spec.interaction,summaryText:summaryPayload.summary_text};
const renderedSummaryQuestion=questionPassageHtml(summaryQuestionView,null,[],[],{escape:identity})+questionSummaryHtml(summaryQuestionView,{escape:identity});
assert.equal(occurrences(renderedSummaryQuestion,summaryText),1,'The student renderer must show a summary source block exactly once');
assert.deepEqual(validateQuestionSpec(summaryPayload,'multiple_choice','available').errors,[]);

const naturalOrder='Intro tells readers about nudges. A section says to move. C section says inducing is useful. B section says guides are gentle and ban is wrong.';
const orderedSpan=(id,role,value,label='')=>{const blockStart=naturalOrder.indexOf(value);return {id,kind:'canonical_span',role,label,passage_id:'order-passage',start:blockStart,end:blockStart+value.length,canonical_text:value,display_text:value};};
const intro='Intro tells readers about nudges.',sectionA='A section says to move.',sectionB='B section says guides are gentle and ban is wrong.',sectionC='C section says inducing is useful.';
const reorderedBlocks=[orderedSpan('intro','intro',intro),orderedSpan('A','A',sectionA,'(A)'),orderedSpan('B','B',sectionB,'(B)'),orderedSpan('C','C',sectionC,'(C)')];
const reorderedPointers=[pointer('order-a','ⓐ','intro',intro,'tells'),pointer('order-b','ⓑ','A',sectionA,'to move'),pointer('order-c','ⓒ','B',sectionB,'guides'),pointer('order-d','ⓓ','B',sectionB,'ban'),pointer('order-e','ⓔ','C',sectionC,'inducing')];
const reordered={...base,source_blocks:reorderedBlocks,prompt:'밑줄 친 ⓐ~ⓔ 중 어법상 어색한 것을 모두 고르시오.',pointers:reorderedPointers,response:{type:'multiple_choice',choices:['ⓐ','ⓑ','ⓒ','ⓓ','ⓔ'],constraints:{}},answer:{source:'publisher_answer_key',indexes:[0,4]}};
assert.deepEqual(questionRepresentationErrors(reordered,{canonicalByPassage:{'order-passage':naturalOrder}}),[]);
const reorderedPayload=projectQuestionRepresentation(reordered,{taxonomy:'grammar_multi_error'});
assert.deepEqual(reorderedBlocks.map(block=>block.start),[0,naturalOrder.indexOf(sectionA),naturalOrder.indexOf(sectionB),naturalOrder.indexOf(sectionC)]);
assert(reorderedBlocks[2].start>reorderedBlocks[3].start,'Fixture must be non-monotonic in canonical order');
assert(segmentCopy(reorderedPayload).indexOf(sectionA)<segmentCopy(reorderedPayload).indexOf(sectionB)&&segmentCopy(reorderedPayload).indexOf(sectionB)<segmentCopy(reorderedPayload).indexOf(sectionC),'Student passage must preserve publisher A-B-C display order');
assert.deepEqual(annotationCopy(reorderedPayload).map(item=>item.label),['ⓐ','ⓑ','ⓒ','ⓓ','ⓔ'],'Annotation order must follow publisher display order');
assert.deepEqual(validateQuestionSpec(reorderedPayload,'multiple_choice','available').errors,[]);

assert.equal(TARGET_PASSAGE_ID,'741d6581-1f4c-4e1d-823c-6be85c62bf52');
console.log('READY semantic Question representation contract verified.');
