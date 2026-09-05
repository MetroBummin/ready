import { contractChoiceCopyHtml, contractPassageHtml, contractResponseControlHtml } from './interaction-runtime.js';

const list=value=>Array.isArray(value)?value:[];

export function questionPassageHtml(question,result,selected,inlineSelected=[],{escape,lookupText=null}={}){
  return contractPassageHtml(question.interactionContract,{escape,result,selected,inlineSelected,lookupText});
}

function questionChoiceHtml(question,index,result,selected,markState,{escape,lookupText=null}){
  const mark=['①','②','③','④','⑤','⑥','⑦','⑧'][index],correct=!!result&&(result.answer?.includes(index)||(result.correct&&selected)),wrong=!!result&&!correct&&selected,state=!result&&(markState==='candidate'||markState==='eliminated')?` ${markState}`:'';
  return `<div class="question-choice${state} ${selected?'selected':''} ${correct?'correct':''} ${wrong?'wrong':''}" role="${question.multiSelect?'checkbox':'radio'}" aria-checked="${selected}" tabindex="${result?'-1':'0'}" data-question-choice="${index}" data-choice-mark="${escape(markState||'neutral')}"><span class="question-choice-mark">${mark}</span><span class="question-choice-copy">${contractChoiceCopyHtml(question.interactionContract,index,escape,lookupText)}</span></div>`;
}

export function questionWritingReference(question){
  const layout=question?.interactionContract?.response?.layout,guide=question?.writingGuide;
  if(!['sentence','sentence_cloze'].includes(layout))return null;
  const targets=list(guide.targets).filter(target=>String(target?.text||'').trim());
  const text=targets.length?targets.map(target=>target.text).join('\n'):String(guide?.taskText||'').trim();
  return text?{label:guide.taskLabel||'영작할 우리말',text}:null;
}

export function questionWritingSupportHtml(question,{escape}={}){
  const guide=question?.writingGuide,reference=questionWritingReference(question),conditions=list(guide?.conditions),layout=question?.interactionContract?.response?.layout,bank=layout==='arrangement'?[]:list(guide?.wordBank);
  const referenceHtml=reference?`<section class="writing-reference"><strong>${escape(reference.label)}</strong><p>${escape(reference.text)}</p></section>`:'';
  const conditionsHtml=conditions.length?`<details class="writing-conditions"><summary>조건 ${conditions.length}개 보기 <span aria-hidden="true">⌄</span></summary><ul>${conditions.map(item=>`<li>${escape(item)}</li>`).join('')}</ul></details>`:'';
  const bankHtml=bank.length?`<section class="writing-bank" aria-label="사용할 말"><strong>사용할 말</strong><div>${bank.map(item=>`<span>${escape(item)}</span>`).join('<i aria-hidden="true">·</i>')}</div></section>`:'';
  return `${referenceHtml}${conditionsHtml}${bankHtml}`;
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

function contractInteractiveTemplateHtml(contract,values,result,escape){
  const response=contract.response;
  return list(response?.template).map(item=>item.kind==='text'?escape(item.text):`<span class="writing-frame-slot" style="--slot-words:${Math.max(1,Number(response.slots[item.slotIndex]?.wordCount)||1)}">${contractResponseControlHtml(contract,item.slotIndex,{escape,value:values[item.slotIndex]||'',disabled:!!result})}</span>`).join('');
}

function writtenOrderHtml(contract,guide,values,result,escape,selection=[]){
  const words=list(guide?.wordBank),value=values[0]||'';
  if(!words.length)return writtenSlotsHtml(contract,values,result,escape);
  const used=new Set(selection);
  return `<div class="writing-order" data-writing-order><div class="writing-order-built" data-writing-order-built aria-label="배열한 문장">${selection.map((wordIndex,position)=>`<button type="button" data-writing-order-remove="${position}" ${result?'disabled':''}>${escape(words[wordIndex])}</button>`).join(' ')}</div><div class="writing-order-bank" aria-label="선택할 단어">${words.map((word,index)=>`<button type="button" data-writing-order-add="${index}" ${used.has(index)?'disabled aria-hidden="true"':''} ${result?'disabled':''}>${escape(word)}</button>`).join('')}</div><input class="sr-only" type="text" data-written-slot="0" value="${escape(value)}" tabindex="-1" aria-label="배열한 답" ${result?'disabled':''}></div>`;
}

export function questionSummaryHtml(question,{escape}={}){
  const response=question.interactionContract?.response;
  return response?.layout==='summary'?contractTemplateHtml(response,escape):escape(question.summaryText);
}

export function questionResponseAreaHtml(question,result,selected,choiceMarks=[],{escape,lookupText=null,orderSelection=[]}={}){
  if(question.responseType!=='written')return `${result?'':'<p class="choice-swipe-hint">왼쪽으로 밀면 제외 · 오른쪽으로 밀면 정답 후보</p>'}<section class="question-answer-area${question.interaction==='choice_matrix'?' choice-matrix':''}" aria-label="선택지">${list(question.choices).map((_,index)=>questionChoiceHtml(question,index,result,list(selected).includes(index),choiceMarks[index],{escape,lookupText})).join('')}</section>`;
  const values=list(selected),contract=question.interactionContract,response=contract.response,slots=response.slots,guide=question.writingGuide,targets=list(guide?.targets);
  if(response.layout==='correction')return `<section class="written-workspace correction">${targets.map((target,index)=>`<label><span class="correction-source"><b>${escape(target.label)}</b><em>${escape(target.text)}</em></span><i aria-hidden="true">→</i><span class="correction-answer"><small>${escape(slots[index].label)}</small>${contractResponseControlHtml(contract,index,{escape,value:values[index]||'',disabled:!!result})}</span></label>`).join('')}</section>`;
  if(response.layout==='multi_correction')return `<section class="written-workspace multi-correction"><div class="correction-reference">${targets.map(target=>`<span><b>${escape(target.label)}</b>${escape(target.text)}</span>`).join('')}</div>${writtenSlotsHtml(contract,values,result,escape)}</section>`;
  if(['sentence_cloze','summary'].includes(response.layout))return `<section class="written-workspace ${response.layout.replace('_','-')}"><div class="cloze-frame writing-inline-frame" lang="en">${contractInteractiveTemplateHtml(contract,values,result,escape)}</div></section>`;
  if(response.layout==='arrangement')return `<section class="written-workspace arrangement">${writtenOrderHtml(contract,guide,values,result,escape,orderSelection)}</section>`;
  if(['sentence_parts','short_answers'].includes(response.layout))return `<section class="written-workspace ${response.layout.replace('_','-')}">${writtenSlotsHtml(contract,values,result,escape)}</section>`;
  const slot=slots[0];return `<section class="written-workspace ${escape(response.layout)}"><label class="sentence-answer"><span>${escape(slot.label)}</span>${contractResponseControlHtml(contract,0,{escape,value:values[0]||'',disabled:!!result})}</label></section>`;
}
