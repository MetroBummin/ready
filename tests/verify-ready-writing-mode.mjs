import assert from 'node:assert/strict';
import fs from 'node:fs';
import { QUESTION_REFERENCE_MANIFEST } from './fixtures/question-reference-bank.mjs';
import { questionResponseAreaHtml, questionWritingReference, questionWritingSupportHtml } from '../ready/question-renderer.js';

const escape=value=>String(value??'').replace(/[&<>']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;'}[char]));
const cases=[
  [1,8,'sentence',1],[1,11,'short_answers',2],[1,13,'multi_correction',2],[1,17,'arrangement',1],[1,19,'sentence',1],
  [2,9,'sentence',1],[2,12,'sentence_parts',2],[2,13,'summary',7],[2,16,'sentence_cloze',4],[2,18,'arrangement',1],
  [3,4,'summary',3],[3,8,'arrangement',1],[3,10,'sentence',1],[3,12,'multi_correction',2],[3,17,'sentence_cloze',4],
  [4,3,'summary',3],[4,5,'summary',7],[4,8,'sentence_cloze',4],[4,11,'sentence_cloze',4],
];

assert.equal(cases.length,19);
for(const [round,questionNo] of cases){
  const source=QUESTION_REFERENCE_MANIFEST.find(item=>item.round===round&&item.questionNo===questionNo);
  assert(source?.answerVerified,`Round ${round} Q${questionNo} must remain tied to the verified publisher reference bank`);
}

function question(layout,slotCount){
  const slots=Array.from({length:slotCount},(_,index)=>({id:`slot-${index}`,label:String(index+1),control:layout==='sentence'?'textarea':'text',wordCount:1,placeholder:'답을 입력하세요'}));
  const template=['summary','sentence_cloze'].includes(layout)?slots.flatMap((_,index)=>[{kind:'text',text:index?' ':'Frame '},{kind:'slot',slotIndex:index}]):[];
  return {responseType:'written',writingGuide:{targets:[{label:'㉠',text:'출판사 영작 대상 문장'}],conditions:['첫 번째 조건','두 번째 조건'],wordBank:['alpha','beta','gamma']},interactionContract:{response:{layout,slots,template}}};
}

for(const [, ,layout,slotCount] of cases){
  const item=question(layout,slotCount),html=questionResponseAreaHtml(item,null,Array(slotCount).fill(''),[],{escape});
  assert.equal((html.match(/data-written-slot=/g)||[]).length,slotCount,`${layout} must render each contract slot exactly once`);
  if(['summary','sentence_cloze'].includes(layout)){
    assert.match(html,/writing-inline-frame/);
    assert.doesNotMatch(html,/written-slot-list/,'Interactive frames must not duplicate their blanks below the sentence');
  }
  if(layout==='arrangement')assert.match(html,/data-writing-order-add="0"/,'Ordering uses selectable source chips');
}

const sentence=question('sentence',1),short=question('short_answers',2);
assert.deepEqual(questionWritingReference(sentence),{label:'영작할 우리말',text:'출판사 영작 대상 문장'});
assert.equal(questionWritingReference(short),null,'Passage lookup answers must not receive a manufactured reference');
const support=questionWritingSupportHtml(sentence,{escape});
assert.match(support,/writing-reference/);
assert.match(support,/<details class="writing-conditions">/);
assert.doesNotMatch(support,/<details class="writing-conditions" open/,'Conditions default to collapsed');
assert.match(support,/alpha<\/span><i aria-hidden="true">·<\/i>/,'Word bank remains compact and publisher ordered');

const objective={responseType:'choice',multiSelect:false,interaction:'single_choice',choices:['A','B'],interactionContract:{kind:'single_choice',choices:{rows:[{cells:['A']},{cells:['B']}],columns:[]},response:{slots:[]}}};
const objectiveHtml=questionResponseAreaHtml(objective,null,[],[],{escape});
assert.match(objectiveHtml,/question-answer-area/);
assert.doesNotMatch(objectiveHtml,/writing-|written-/,'Objective response markup must remain outside Writing Mode');

const app=fs.readFileSync(new URL('../ready/app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../ready/design.css',import.meta.url),'utf8');
assert.match(app,/visualViewport\?\.addEventListener\('resize',syncWritingViewport\)/,'Keyboard geometry uses one Visual Viewport resize owner');
assert.match(app,/focusin[\s\S]*setQuestionSheetState\('expanded'\)/,'Focusing an answer enters Writing Mode');
assert.match(app,/autoGrowWrittenTextarea/,'Sentence textareas auto-grow without rerendering the Question');
assert.match(css,/\.writing-question \.question-solving-surface\{[^}]*height:auto[^}]*max-height:min\(78dvh/,'Written sheets use natural height with a bounded viewport maximum');
assert.match(css,/\.writing-bank>div\{[^}]*overflow-x:auto/,'Word bank owns compact horizontal scrolling');

console.log('READY Writing Mode and rounds 1-4 regression verified.');
