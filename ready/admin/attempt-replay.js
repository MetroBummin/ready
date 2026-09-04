import { questionPassageHtml, questionResponseAreaHtml, questionSummaryHtml } from '../question-renderer.js';

const list=value=>Array.isArray(value)?value:[];
const marks=['①','②','③','④','⑤','⑥','⑦','⑧'];

function flatAnswers(value){return list(value).flatMap(item=>Array.isArray(item)?item:[item]).map(item=>String(item??'').trim()).filter(Boolean);}

function questionAnswerLines(question,values){
  if(question.responseType==='written')return flatAnswers(values);
  if(question.interaction==='inline_options')return list(values).map((value,index)=>`${index+1}. ${question.inlineGroups?.[index]?.options?.[Number(value)]||'—'}`);
  return list(values).map(value=>`${marks[Number(value)]||Number(value)+1} ${question.choices?.[Number(value)]||''}`.trim());
}

function replayComparison(label,values,escape){
  return `<div><strong>${escape(label)}</strong>${values.length?values.map(value=>`<span>${escape(value)}</span>`).join(''):'<span>응답 없음</span>'}</div>`;
}

export function questionAttemptReplayHtml(data,escape){
  if(!data?.replayable)return `<div class="learning-replay-fallback"><strong>완전 재현 불가</strong><p>${escape(data?.message||'현재 Question과 attempt를 연결할 수 없습니다.')}</p>${data?.attempt?.response?`<pre>${escape(JSON.stringify(data.attempt.response,null,2))}</pre>`:''}</div>`;
  const question=data.question,response=data.response||{},selected=question.responseType==='written'?list(response.responses):list(response.selected),inlineSelected=list(response.inlineSelected),result={correct:data.attempt.correct===true,answer:list(data.answer)},extras=new Set(question.renderSpec?.extras||[]),displayPrompt=question.writingGuide?.title||question.prompt;
  const studentLines=questionAnswerLines(question,question.responseType==='written'?response.responses:question.interaction==='inline_options'?response.inlineSelected:response.selected),answerLines=questionAnswerLines(question,data.answer);
  return `<article class="learning-question-replay question-layout" data-question-phase="submitted"><div class="reader-shell"><div class="question-topline"><span class="question-progress">${escape(data.passage?.title||'Question attempt')}</span><span class="learning-replay-readonly">READ ONLY</span></div><p class="eyebrow">PASSAGE · ${escape((question.renderer||question.family||'standard').toUpperCase())}</p>${question.stimulus&&extras.has('stimulus')?`<section class="question-stimulus"><strong>주어진 문장</strong>${escape(question.stimulus)}</section>`:''}${question.interactionContract?.passage?.visible?`<article class="reading-passage question-passage">${questionPassageHtml(question,result,selected,inlineSelected,{escape})}</article>`:''}<h1 class="question-prompt">${escape(displayPrompt)}</h1>${question.summaryText&&extras.has('summary')?`<section class="question-summary">${questionSummaryHtml(question,{escape})}</section>`:''}${questionResponseAreaHtml(question,result,selected,[],{escape})}<section class="learning-answer-compare">${replayComparison('학생 제출',studentLines,escape)}${replayComparison('정답',answerLines,escape)}</section>${question.explanation?`<div class="question-feedback wrong"><strong>해설</strong><p class="explanation-reveal">${escape(question.explanation)}</p></div>`:''}<p class="learning-snapshot-note">이 attempt에는 당시 Question payload snapshot이 없어 현재 generation ${Number(data.snapshot?.currentGeneration)||1} 기준으로 재현했습니다.</p></div></article>`;
}

function workbookBlankReplay(item,values,answers,slotResults,escape){
  let slot=0;
  return String(item.prompt||'').split(/_{5,}/).map((part,index,all)=>{if(index===all.length-1)return escape(part);const current=slot++,correct=slotResults[current]===true;return `${escape(part)}<span class="workbook-blank ${correct?'correct':'wrong'}"><input type="text" value="${escape(values[current]||'')}" disabled><small class="workbook-answer">정답: ${escape(answers[current]||'—')}</small></span>`;}).join('');
}

function workbookChoiceReplay(item,values,answers,slotResults,escape){
  return String(item.prompt||'').split(/(⟦CHOICE:\d+⟧)/).map(part=>{const marker=part.match(/^⟦CHOICE:(\d+)⟧$/);if(!marker)return escape(part);const index=Number(marker[1]),options=list(item.groups?.[index]);return `<span class="workbook-choice-group ${slotResults[index]?'correct':'wrong'}">${options.map((option,optionIndex)=>`<button type="button" class="workbook-choice${values[index]===option?' selected':''}${answers[index]===option?' correct':''}" disabled><span>${escape(option)}</span>${values[index]===option?'<b aria-hidden="true">✓</b>':''}</button>${optionIndex===0?'<i class="workbook-choice-or" aria-hidden="true">또는</i>':''}`).join('')}<small>정답: ${escape(answers[index]||'—')}</small></span>`;}).join('');
}

function workbookCorrectionReplay(item,values,answers,slotResults,escape){
  return `<p class="workbook-correction-instruction">${item.subtype==='grammar'?'어법상 어색한 표현을 찾아 바르게 고치세요.':item.subtype==='context'?'문맥상 어색한 표현을 찾아 바르게 고치세요.':'어색한 표현을 찾아 바르게 고치세요.'}</p><div class="workbook-task-passage" lang="en">${escape(item.prompt)}</div><div class="workbook-correction-list">${Array.from({length:item.pairCount},(_,pair)=>{const left=pair*2,right=left+1,correct=slotResults[left]&&slotResults[right];return `<div class="workbook-correction-row ${correct?'correct':'wrong'}"><span>${pair+1}</span><label>학생 표현<input value="${escape(values[left]||'')}" disabled></label><b aria-hidden="true">→</b><label>학생 수정<input value="${escape(values[right]||'')}" disabled></label><small>정답: ${escape(answers[left]||'—')} → ${escape(answers[right]||'—')}</small></div>`;}).join('')}</div>`;
}

function workbookOrderReplay(item,values,answers,slotResults,escape){
  let slot=0;
  return `<div class="workbook-prompt order-task" lang="en">${String(item.prompt||'').split(/(⟦ORDER:\d+⟧)/).map(part=>{const marker=part.match(/^⟦ORDER:(\d+)⟧$/);if(!marker)return escape(part);const index=slot++;return `<span class="workbook-order-group ${slotResults[index]?'correct':'wrong'}"><span class="workbook-order-built">${escape(values[index]||'응답 없음')}</span><small>정답: ${escape(answers[index]||'—')}</small></span>`;}).join('')}</div>`;
}

export function workbookAttemptReplayHtml(data,escape){
  if(!data?.replayable)return `<div class="learning-replay-fallback"><strong>완전 재현 불가</strong><p>${escape(data?.message||'현재 Workbook catalog와 attempt를 연결할 수 없습니다.')}</p>${data?.attempt?.response?`<pre>${escape(JSON.stringify(data.attempt.response,null,2))}</pre>`:''}</div>`;
  const item=data.item,values=list(data.response),answers=list(data.answers),slotResults=list(data.slotResults);let task='';
  if(item.kind==='translation_ai')task=`<label class="workbook-translation"><span>학생 해석</span><textarea rows="3" disabled>${escape(values[0]||'')}</textarea><small>정답: ${escape(answers[0]||'—')}</small></label>`;
  else if(item.kind==='choice_groups')task=`<div class="workbook-prompt choice-task" lang="en">${workbookChoiceReplay(item,values,answers,slotResults,escape)}</div>`;
  else if(item.kind==='correction_pairs')task=workbookCorrectionReplay(item,values,answers,slotResults,escape);
  else if(item.kind==='reorder_groups')task=workbookOrderReplay(item,values,answers,slotResults,escape);
  else task=`<div class="workbook-prompt" lang="${Number(item.stage)===2?'ko':'en'}">${workbookBlankReplay(item,values,answers,slotResults,escape)}</div>`;
  const hint=data.attempt||{};
  return `<article class="learning-workbook-replay workbook-card"><header class="workbook-study-head"><div><p class="eyebrow">STAGE ${Number(item.stage)} · ATTEMPT</p><h2>${escape(data.workbook?.title||data.passage?.title||'Workbook')}</h2><small>${escape(data.passage?.title||'')} · ${escape(item.kind)}</small></div><span class="learning-replay-readonly">READ ONLY</span></header>${item.source?`<blockquote>${escape(item.source)}</blockquote>`:''}${task}<section class="learning-attempt-meta"><span>힌트 ${Number(hint.hint_count)||0}회</span>${hint.used_full_answer_hint?'<span>전체 답 힌트 사용</span>':''}${hint.completed_after_hint?'<span>힌트 후 완성</span>':''}</section><p class="learning-snapshot-note">attempt의 workbook_key와 item_key를 현재 catalog에 매칭해 재현했습니다. 당시 item snapshot은 저장되어 있지 않습니다.</p></article>`;
}
