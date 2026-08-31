import assert from 'node:assert/strict';
import { validateWrittenStructure } from '../tools/ready-written-contract.mjs';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';
import { buildStructuredSourceContract, sourceContractErrors } from '../tools/ready-source-contract.mjs';
import { buildObjectiveSourceContract } from '../tools/ready-source-contract.mjs';
import { compileInteractionContract } from '../tools/ready-interaction-contract.mjs';
import { applyGuidedClozeContract, structureGuidedCloze } from '../tools/ready-guided-cloze.mjs';
import { publicInteractionContract } from '../server/ready/interaction-contract.mjs';

const canonical='His location settings were turned off. He used the last of his battery to send a text message.';
const base={type:'written_response',payload:{
  prompt:'밑줄 친 ⓔ의 어색한 곳을 바르게 고쳐 쓰시오.',
  _raw_question_text:'His location settings were ⓔturned off. <조건> 두 단어로 쓸 것',
  explanation:'ⓔ turned off는 전원이 꺼졌다는 뜻이다.',
  accepted_answers:[['turned off']],
}};
const clean={kind:'correction',prompt_text:base.payload.prompt,passage_mode:'canonical_excerpt',passage_text:'His location settings were turned off.',task_text:'어색한 곳을 바르게 고쳐 쓰시오.',targets:[{label:'ⓔ',text:'turned off',canonical_text:'turned off'}],conditions:['두 단어로 쓸 것'],word_bank:[],response_slots:[{label:'답 1',word_count:2}],summary_text:'',confidence:.99,issues:[]};

assert.deepEqual(validateWrittenStructure(base,clean,canonical),[]);

const errors=overrides=>validateWrittenStructure(base,{...clean,...overrides},canonical);
assert(errors({prompt_text:'다른 문제'}).some(item=>item.includes('prompt changed')));
assert(errors({passage_mode:'authored_variant',passage_text:'This text is outside the PDF source.'}).some(item=>item.includes('cannot be verified')));
assert(errors({passage_text:'His location settings were turned off. 요약문 (A) ______'}).some(item=>item.includes('question apparatus')));
assert(errors({targets:[{label:'ⓔ',text:'turned',canonical_text:'turned off'}]}).some(item=>item.includes('full marked phrase')));
assert(errors({response_slots:[]}).some(item=>item.includes('slot count')));
assert(errors({response_slots:[{label:'답 1',word_count:1}]}).some(item=>item.includes('word count')));
assert(errors({conditions:[]}).some(item=>item.includes('conditions missing')));

const emptyPublisherAnswer=structuredClone(base);
emptyPublisherAnswer.payload.accepted_answers=["'"];
assert(validateWrittenStructure(emptyPublisherAnswer,{...clean,response_slots:[{label:'답 1',word_count:0}]},canonical).some(item=>item.includes('no lexical publisher answer')));

const overlayBase={type:'written_response',payload:{prompt:'밑줄 친 ⓐ를 고쳐 쓰시오.',_raw_question_text:'The event will ⓐhold tomorrow. (A) 행사는 열릴 것이다.',explanation:'수동태가 필요하다.',accepted_answers:[['be held']]}};
const overlay={kind:'correction',prompt_text:overlayBase.payload.prompt,passage_mode:'authored_variant',passage_text:'The event will hold tomorrow.',task_text:'',targets:[{label:'ⓐ',text:'hold',canonical_text:'be held'}],conditions:[],word_bank:[],response_slots:[{label:'ⓐ',word_count:2}],summary_text:'',confidence:.99,issues:[]};
assert.deepEqual(validateWrittenStructure(overlayBase,overlay,'The event will be held tomorrow.'),[]);
assert(validateWrittenStructure(overlayBase,{...overlay,passage_text:'The event hold tomorrow.'},'The event will be held tomorrow.').some(item=>item.includes('cannot be verified')));

const summaryQuestion={type:'written_response',payload:{prompt:'다음 글의 요약문의 빈칸 (A), (B)를 완성하시오.',_raw_question_text:'Source passage. 요약문: (A) ____ (B) ____',explanation:'해설',accepted_answers:[['one'],['two words']]}};
const summarySpec={kind:'summary',prompt_text:summaryQuestion.payload.prompt,passage_mode:'canonical_excerpt',passage_text:'Source passage.',task_text:'',targets:[],conditions:[],word_bank:[],response_slots:[{label:'A',word_count:1},{label:'B',word_count:2}],summary_text:'',confidence:.99,issues:[]};
assert(validateWrittenStructure(summaryQuestion,summarySpec,'Source passage.').some(item=>item.includes('summary missing')));

const renderPayload={prompt:'영작하시오.',set_text:'This is the approved source passage.',taxonomy:'guided_writing',source:{provider:'exam4you'},writing_guide:{kind:'sentence',title:'영작하시오.',slot_labels:['답'],conditions:[],word_bank:[],task_text:'문장을 쓰시오.',targets:[]},accepted_answers:['answer'],response_slots:[{label:'답',word_count:1}],import_status:'ready',spec:{renderer:'written_input',passage:{source:'blocks',annotations:[]},extras:[],choiceMode:'none',responseMode:'input',gradingMode:'accepted_variants'}};
assert.equal(validateQuestionSpec(renderPayload,'written_response','available').ready,false);
buildStructuredSourceContract({payload:renderPayload,structured:{passage_text:renderPayload.set_text,task_text:'문장을 쓰시오.',conditions:[],word_bank:[],summary_text:'',targets:[],response_slots:renderPayload.response_slots},sourceFileHash:'a'.repeat(64)});
renderPayload.ai_structure={engine:'codex-cli',contract_version:2};
compileInteractionContract(renderPayload,'written_response');
assert.equal(validateQuestionSpec(renderPayload,'written_response','available').ready,true);
const zeroWordSlot=structuredClone(renderPayload);
zeroWordSlot.accepted_answers=["'"];
zeroWordSlot.response_slots=[{label:'답',word_count:0}];
compileInteractionContract(zeroWordSlot,'written_response');
assert.equal(validateQuestionSpec(zeroWordSlot,'written_response','available').ready,false);

const summaryPayload=structuredClone(renderPayload);
summaryPayload.prompt='다음 글을 요약한 문장의 빈칸 (A), (B)를 완성하시오.';
summaryPayload.taxonomy='summary_completion';
summaryPayload.summary_text='The first answer is (A) _____ and the second is (B) _____.';
summaryPayload.accepted_answers=[['one'],['two words']];
summaryPayload.response_slots=[{label:'(A)',word_count:1},{label:'(B)',word_count:2}];
summaryPayload.writing_guide={...summaryPayload.writing_guide,kind:'summary',title:summaryPayload.prompt,slot_labels:['(A)','(B)']};
summaryPayload.spec.extras=['summary'];
buildStructuredSourceContract({payload:summaryPayload,structured:{passage_text:summaryPayload.set_text,task_text:'요약문을 완성하시오.',conditions:[],word_bank:[],summary_text:summaryPayload.summary_text,targets:[],response_slots:summaryPayload.response_slots},sourceFileHash:'a'.repeat(64)});
compileInteractionContract(summaryPayload,'written_response');
assert.equal(summaryPayload.spec.interaction.response.template.filter(item=>item.kind==='slot').length,2);
assert.equal(publicInteractionContract(summaryPayload.spec.interaction).response.slots[1].wordCount,2);
const summaryValidation=validateQuestionSpec(summaryPayload,'written_response','available');
assert.equal(summaryValidation.ready,true,summaryValidation.errors.join('\n'));
const brokenSummary=structuredClone(summaryPayload);
brokenSummary.spec.interaction.response.template=brokenSummary.spec.interaction.response.template.filter(item=>item.kind!=='slot'||item.slotIndex!==1);
assert.equal(validateQuestionSpec(brokenSummary,'written_response','available').ready,false);

const clozePayload=structuredClone(renderPayload);
clozePayload.prompt='각 빈칸에 한 단어씩 쓸 것 보기 There / same / scene 보기____ ____ hints from research showing that your brain uses the ____ regions to imagine a ____.';
clozePayload.accepted_answers=[['There are hints from research showing that your brain uses the same regions to imagine a scene']];
clozePayload.writing_guide={...clozePayload.writing_guide,kind:'sentence',title:clozePayload.prompt};
clozePayload.response_slots=[{label:'(A)',word_count:16}];
const cloze=structureGuidedCloze(clozePayload);
assert.equal(cloze?.responseSlots.length,4);
assert.deepEqual(cloze?.acceptedAnswers,[['there'],['are'],['same'],['scene']]);
assert.deepEqual(cloze?.responseSlots.map(slot=>slot.label),['1','2','3','4']);
assert.equal(applyGuidedClozeContract(clozePayload),true);
buildStructuredSourceContract({payload:clozePayload,structured:{passage_text:clozePayload.set_text,task_text:clozePayload.writing_guide.task_text,conditions:[],word_bank:[],summary_text:'',targets:[],response_slots:clozePayload.response_slots},sourceFileHash:'a'.repeat(64)});
compileInteractionContract(clozePayload,'written_response');
assert.equal(clozePayload.spec.interaction.response.layout,'sentence_cloze');
assert.equal(clozePayload.spec.interaction.passage.visible,false,'Partial guided writing must never expose the publisher answer above its blanks');
assert.equal(clozePayload.spec.interaction.response.template.filter(item=>item.kind==='slot').length,4);
assert.equal(validateQuestionSpec(clozePayload,'written_response','available').ready,true);
const brokenCloze=structuredClone(clozePayload);
brokenCloze.spec.interaction.response.template=brokenCloze.spec.interaction.response.template.filter(item=>item.kind!=='slot'||item.slotIndex!==2);
assert.equal(validateQuestionSpec(brokenCloze,'written_response','available').ready,false);

const polluted=structuredClone(renderPayload);
polluted.source_blocks.find(block=>block.block_kind==='passage').source_text+=' 영작하시오.';
assert(sourceContractErrors(polluted,polluted.spec).some(item=>item.includes('Korean text')));
const wrongFamily=structuredClone(renderPayload);
wrongFamily.spec.renderer='standard_mcq';
assert(sourceContractErrors(wrongFamily,wrongFamily.spec).some(item=>item.includes('does not allow korean_target')));
const missingProvenance=structuredClone(renderPayload);
delete missingProvenance.pipeline_contract.block_refs.passage;
assert(sourceContractErrors(missingProvenance,missingProvenance.spec).some(item=>item.includes('passage provenance')));

const objective={prompt:'윗글의 제목으로 알맞은 것은?',set_text:'His location settings were turned off.',taxonomy:'title',choices:['A','B','C','D','E'],answer:[0],multi_select:false,explanation:'해설',import_status:'ready',source:{provider:'exam4you',exam:'시험',section:'1',source_question_no:1,document_sha256:'b'.repeat(64),page:1,bbox:[0,0,100,100]},spec:{renderer:'standard_mcq',passage:{source:'blocks',annotations:[]},extras:[],choiceMode:'single',responseMode:'choice',gradingMode:'exact'}};
buildObjectiveSourceContract(objective);
compileInteractionContract(objective,'multiple_choice');
assert.equal(validateQuestionSpec(objective,'multiple_choice','available').ready,true);
const KoreanPassage=structuredClone(objective);KoreanPassage.set_text+=' 우리말';buildObjectiveSourceContract(KoreanPassage);
assert(sourceContractErrors(KoreanPassage,KoreanPassage.spec).some(item=>item.includes('Korean text')));
const oversized=structuredClone(objective);oversized.set_text='A'.repeat(1801);buildObjectiveSourceContract(oversized);
assert(sourceContractErrors(oversized,oversized.spec).some(item=>item.includes('student range budget')));
const truncatedPhrase=structuredClone(objective);
truncatedPhrase.taxonomy='grammar_single_error';truncatedPhrase.spec.renderer='annotated_passage_mcq';truncatedPhrase.target_ranges=[{label:'ⓔ',text:'turned',kind:'target'}];truncatedPhrase._raw_question_text='His location settings were ⓔturned off.';buildObjectiveSourceContract(truncatedPhrase);
assert.equal(truncatedPhrase.target_ranges[0].label,'ⓔ','Display normalization destroyed a semantic circled label');
assert(sourceContractErrors(truncatedPhrase,truncatedPhrase.spec).some(item=>item.includes('truncates a marked phrasal span')));
const truncatedFixed=structuredClone(objective);
truncatedFixed.taxonomy='grammar_single_error';truncatedFixed.spec.renderer='annotated_passage_mcq';truncatedFixed.set_text='In order to educate detectives, Lee built models.';truncatedFixed.target_ranges=[{label:'ⓓ',text:'In',kind:'target'}];truncatedFixed._raw_question_text='ⓓIn order to educate detectives, Lee built models.';buildObjectiveSourceContract(truncatedFixed);
assert(sourceContractErrors(truncatedFixed,truncatedFixed.spec).some(item=>item.includes('truncates the fixed expression in order to')));
const inactiveDevice=structuredClone(objective);inactiveDevice.set_text='She believed (A)[that / what] the system worked.';buildObjectiveSourceContract(inactiveDevice);
assert(sourceContractErrors(inactiveDevice,inactiveDevice.spec).some(item=>item.includes('inactive passage device')));
const bareLabel=structuredClone(objective);bareLabel.taxonomy='grammar_single_error';bareLabel.spec.renderer='annotated_passage_mcq';bareLabel.set_text='She believed that the system worked.';bareLabel.target_ranges=[{label:'A',text:'that',kind:'target'}];buildObjectiveSourceContract(bareLabel);
assert.equal(bareLabel.target_ranges[0].label,'(A)');
assert.equal(sourceContractErrors(bareLabel,bareLabel.spec).some(item=>item.includes('non-renderable label')),false);
const missingPublisherUnderline=structuredClone(objective);missingPublisherUnderline.prompt='밑줄 친 부분의 지칭 대상이 다른 것은?';buildObjectiveSourceContract(missingPublisherUnderline);
assert(sourceContractErrors(missingPublisherUnderline,missingPublisherUnderline.spec).some(item=>item.includes('geometry-validated annotation')));

console.log('READY written import contract verification passed.');
