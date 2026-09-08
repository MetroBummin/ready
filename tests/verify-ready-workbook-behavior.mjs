import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {gradeLocalWorkbook} from '../ready/deterministic-grading.js';
import {workbookRecallCue,koreanRecallCompositionState,workbookRecallIsPendingJamo} from '../ready/workbook-assistance.js';
import {workbookEnterAction,progressiveOrderState} from '../ready/workbook-interaction.js';

for(const [answer,mode,good,bad] of [['보호해야','korean_syllable','보','ㅂ'],['Discovering','english_initial','D','x']]) {
  assert.equal(workbookRecallCue(good,mode),workbookRecallCue(answer,mode));
  assert.notEqual(workbookRecallCue(bad,mode),workbookRecallCue(answer,mode));
}
for(const [value,answer,state] of [['','관찰','empty'],['ㄱ','관찰','partial'],['고','관찰','partial'],['과','관찰','partial'],['관','관찰','exact'],['각','관찰','mismatch'],['ㄱ','값','partial'],['갑','값','partial'],['값','값','exact'],['ㄴ','값','mismatch']]) assert.equal(koreanRecallCompositionState(value,answer).state,state,`${value} -> ${answer}`);
assert.equal(workbookRecallIsPendingJamo('ᄀ','korean_syllable'),true);
assert.equal(workbookRecallIsPendingJamo('D','english_initial'),false);
assert.deepEqual(workbookEnterAction(['','','third'],2),{type:'focus',index:0},'Enter wraps to an earlier unfinished slot');
for(const [type,answers,wrong] of [['verb_form',['was chosen','to protect'],['choose','protect']],['grammar_choice',['which','seeing'],['that','seen']]]) {
  const contract={mode:'deterministic',answers,semanticType:type};
  assert.equal(gradeLocalWorkbook(contract,answers).correct,true);
  assert.equal(gradeLocalWorkbook(contract,wrong).correct,false);
  assert.deepEqual(gradeLocalWorkbook(contract,[answers[0],'']).slotResults,[true,false]);
  assert.equal(gradeLocalWorkbook(contract,answers,{usedFullAnswerHint:true}).correct,false);
  assert.equal(gradeLocalWorkbook(contract,answers).needsServer,false);
}

// Execute the actual production state transitions, with rendering as the only
// stub. No reimplementation of retry/later, network, DOM, or persistence here.
const source=readFileSync(new URL('../ready/app.js',import.meta.url),'utf8');
const functions=['retryWorkbook','deferWorkbook'].map(name=>{
  const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);
  assert.ok(start>=0&&end>start,`${name} must remain executable`);
  return source.slice(start,end);
}).join('\n');
function harness(kind='blank_input') {
  const item={key:'a',kind,slotCount:2,groups:[['a','b','c']]},other={key:'b',kind,slotCount:2};
  const stage={items:[item,other],correctClears:1,progressPercent:50,currentCycleClears:['b']};
  const session={itemIndex:0,responses:{a:['kept','wrong'],b:['other','answer']},results:{a:{correct:false,slotResults:[true,false]}},assistance:{a:{hintUsed:true}},orderSelections:{a:[[2]]},orderConsumedChips:{a:[[2]]},orderBatchOrders:{a:{0:[2,0,1]}}};
  const renders=[];const context=vm.createContext({workbookCurrent:()=>({session,stage,item:stage.items[session.itemIndex]}),workbookAssistanceState:()=>session.assistance.a,renderWorkbook:options=>renders.push(options)});
  vm.runInContext(functions,context);
  return {session,stage,context,renders};
}
let h=harness(); const progress=JSON.stringify(h.stage);
vm.runInContext('retryWorkbook()',h.context);
assert.deepEqual([...h.session.responses.a],['kept','']);
assert.equal(h.session.results.a,undefined);assert.equal(h.session.assistance.a.hintUsed,true);
assert.equal(JSON.stringify(h.stage),progress,'retry cannot grant a clear or mutate item order');
assert.equal(h.renders.at(-1).preferEmpty,true);
h=harness('reorder_groups');vm.runInContext('retryWorkbook()',h.context);
assert.deepEqual([...h.session.responses.a],['','']);assert.equal(h.session.orderBatchOrders.a,undefined);
assert.equal(h.session.orderConsumedChips.a,undefined);
assert.equal(progressiveOrderState(['a','b','c'],'a b c',h.session.orderSelections.a[0]).batchIndex,0);
h=harness();const otherResponse=h.session.responses.b;
vm.runInContext('deferWorkbook()',h.context);
assert.deepEqual(h.stage.items.map(i=>i.key),['b','a']);assert.equal(h.session.itemIndex,0);
assert.equal(h.stage.correctClears,1);assert.equal(h.stage.progressPercent,50);assert.deepEqual(h.stage.currentCycleClears,['b']);
assert.deepEqual([...h.session.responses.a],['','']);assert.equal(h.session.responses.b,otherResponse);
assert.equal(h.session.results.a,undefined);assert.equal(h.session.orderBatchOrders.a,undefined);
h=harness();h.stage.items.splice(1);vm.runInContext('deferWorkbook()',h.context);
assert.equal(h.session.itemIndex,0);assert.deepEqual(h.stage.items.map(i=>i.key),['a']);
console.log('READY executable recall / deterministic grading / retry / later contracts passed.');
