import assert from 'node:assert/strict';
import { validateWrittenStructure } from '../tools/ready-written-contract.mjs';

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
assert(errors({passage_mode:'authored_variant',passage_text:'This text is outside the PDF source.'}).some(item=>item.includes('exceeds raw question range')));
assert(errors({passage_text:'His location settings were turned off. 요약문 (A) ______'}).some(item=>item.includes('question apparatus')));
assert(errors({targets:[{label:'ⓔ',text:'turned',canonical_text:'turned off'}]}).some(item=>item.includes('full marked phrase')));
assert(errors({response_slots:[]}).some(item=>item.includes('slot count')));
assert(errors({response_slots:[{label:'답 1',word_count:1}]}).some(item=>item.includes('word count')));
assert(errors({conditions:[]}).some(item=>item.includes('conditions missing')));

const summaryQuestion={type:'written_response',payload:{prompt:'다음 글의 요약문의 빈칸 (A), (B)를 완성하시오.',_raw_question_text:'Source passage. 요약문: (A) ____ (B) ____',explanation:'해설',accepted_answers:[['one'],['two words']]}};
const summarySpec={kind:'summary',prompt_text:summaryQuestion.payload.prompt,passage_mode:'canonical_excerpt',passage_text:'Source passage.',task_text:'',targets:[],conditions:[],word_bank:[],response_slots:[{label:'A',word_count:1},{label:'B',word_count:2}],summary_text:'',confidence:.99,issues:[]};
assert(validateWrittenStructure(summaryQuestion,summarySpec,'Source passage.').some(item=>item.includes('summary missing')));

console.log('READY written import contract verification passed.');
