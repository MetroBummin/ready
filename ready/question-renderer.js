import { contractChoiceCopyHtml, contractPassageHtml, contractResponseControlHtml } from './interaction-runtime.js';

const list=value=>Array.isArray(value)?value:[];

export function questionPassageHtml(question,result,selected,inlineSelected=[],{escape,lookupText=null}={}){
  return contractPassageHtml(question.interactionContract,{escape,result,selected,inlineSelected,lookupText});
}

function questionChoiceHtml(question,index,result,selected,markState,{escape,lookupText=null}){
  const mark=['①','②','③','④','⑤','⑥','⑦','⑧'][index],correct=!!result&&(result.answer?.includes(index)||(result.correct&&selected)),wrong=!!result&&!correct&&selected,state=!result&&(markState==='candidate'||markState==='eliminated')?` ${markState}`:'';
  return `<div class="question-choice${state} ${selected?'selected':''} ${correct?'correct':''} ${wrong?'wrong':''}" role="${question.multiSelect?'checkbox':'radio'}" aria-checked="${selected}" tabindex="${result?'-1':'0'}" data-question-choice="${index}" data-choice-mark="${escape(markState||'neutral')}"><span class="question-choice-mark">${mark}</span><span class="question-choice-copy">${contractChoiceCopyHtml(question.interactionContract,index,escape,lookupText)}</span></div>`;
}

function writingGuideHtml(guide,escape){
  if(!guide)return '';
  const task=guide.taskText?`<section class="writing-target"><strong>${escape(guide.taskLabel||'작성할 내용')}</strong><p>${escape(guide.taskText)}</p></section>`:'',conditions=list(guide.conditions).length?`<section class="writing-conditions"><strong>조건</strong><ul>${guide.conditions.map(item=>`<li>${escape(item)}</li>`).join('')}</ul></section>`:'',bank=list(guide.wordBank).length?`<section class="writing-bank"><strong>사용할 말</strong><div>${guide.wordBank.map(item=>`<span>${escape(item)}</span>`).join('')}</div></section>`:'';
  return `${task}${conditions}${bank}`;
}

function writtenSlotsHtml(contract,values,result,escape){
  return `<div class="written-slot-list">${contract.response.slots.map((slot,index)=>`<label><span>${escape(slot.label)}</span>${contractResponseControlHtml(contract,index,{escape,value:values[index]||'',disabled:!!result})}</label>`).join('')}</div>`;
}

function contractBlankHtml(slot,index,escape){
  const count=Math.max(1,Number(slot?.wordCount)||1);
  return `<span class="contract-blank" role="img" aria-label="${escape(slot?.label||index+1)}번 빈칸, ${count}단어">${Array.from({length:count},()=>'<i aria-hidden="true"></i>').join('')}</span>`;
}

function contractTemplateHtml(response,escape){
  return list(response?.template).map(item=>item.kind==='text'?escape(item.text):contractBlankHtml(response.slots[item.slotIndex],item.slotIndex,escape)).join('');
}

export function questionSummaryHtml(question,{escape}={}){
  const response=question.interactionContract?.response;
  return response?.layout==='summary'?contractTemplateHtml(response,escape):escape(question.summaryText);
}

export function questionResponseAreaHtml(question,result,selected,choiceMarks=[],{escape,lookupText=null}={}){
  if(question.responseType!=='written')return `${result?'':'<p class="choice-swipe-hint">왼쪽으로 밀면 제외 · 오른쪽으로 밀면 정답 후보</p>'}<section class="question-answer-area${question.interaction==='choice_matrix'?' choice-matrix':''}" aria-label="선택지">${list(question.choices).map((_,index)=>questionChoiceHtml(question,index,result,list(selected).includes(index),choiceMarks[index],{escape,lookupText})).join('')}</section>`;
  const values=list(selected),contract=question.interactionContract,response=contract.response,slots=response.slots,guide=question.writingGuide,targets=list(guide?.targets);
  if(response.layout==='correction')return `<section class="written-workspace correction">${writingGuideHtml(guide,escape)}${targets.map((target,index)=>`<label><span class="correction-source"><b>${escape(target.label)}</b><em>${escape(target.text)}</em></span><i aria-hidden="true">→</i><span class="correction-answer"><small>${escape(slots[index].label)}</small>${contractResponseControlHtml(contract,index,{escape,value:values[index]||'',disabled:!!result})}</span></label>`).join('')}</section>`;
  if(response.layout==='multi_correction')return `<section class="written-workspace multi-correction">${writingGuideHtml(guide,escape)}<div class="correction-reference">${targets.map(target=>`<span><b>${escape(target.label)}</b>${escape(target.text)}</span>`).join('')}</div>${writtenSlotsHtml(contract,values,result,escape)}</section>`;
  if(response.layout==='sentence_cloze')return `<section class="written-workspace sentence-cloze">${writingGuideHtml(guide,escape)}<div class="cloze-frame" lang="en">${contractTemplateHtml(response,escape)}</div><div class="written-slot-list cloze-slot-list">${slots.map((slot,index)=>`<label><span>${escape(slot.label)}</span>${contractResponseControlHtml(contract,index,{escape,value:values[index]||'',disabled:!!result})}</label>`).join('')}</div></section>`;
  if(['summary','sentence_parts','short_answers'].includes(response.layout))return `<section class="written-workspace ${response.layout.replace('_','-')}">${writingGuideHtml(guide,escape)}${writtenSlotsHtml(contract,values,result,escape)}</section>`;
  const slot=slots[0];return `<section class="written-workspace ${escape(response.layout)}">${writingGuideHtml(guide,escape)}<label class="sentence-answer"><span>${escape(slot.label)}</span>${contractResponseControlHtml(contract,0,{escape,value:values[0]||'',disabled:!!result})}</label></section>`;
}
