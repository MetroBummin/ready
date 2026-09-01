const list=value=>Array.isArray(value)?value:[];

export function contractPassageHtml(contract,{escape,result=null,inlineSelected=[],selected=[],lookupText=null}={}){
  if(!contract?.passage?.visible)return '';
  const segments=list(contract?.passage?.segments),html=segments.map((segment,index)=>{
    const copy=value=>lookupText?lookupText(value,`passage:${index}`):escape(value);
    if(segment.kind==='text')return copy(segment.text);
    if(segment.kind==='annotation')return `<span class="passage-pointer" data-contract-device="${escape(segment.id)}">${escape(segment.label)}${copy(segment.text)}</span>`;
    if(segment.kind==='blank')return `<span class="passage-blank" data-contract-device="${escape(segment.id)}">${segment.label?`<b>${escape(segment.label)}</b>`:''}<i aria-hidden="true"></i></span>`;
    if(segment.kind==='inline_options'){
      const groupIndex=list(contract.passage.segments).filter(item=>item.kind==='inline_options').indexOf(segment);
      return `<span class="inline-option-group" data-contract-device="${escape(segment.id)}"><b>${escape(segment.label)}</b>${list(segment.options).map((option,optionIndex)=>`<button type="button" data-inline-group="${groupIndex}" data-inline-option="${optionIndex}" class="inline-option${inlineSelected[groupIndex]===optionIndex?' selected':''}" aria-pressed="${inlineSelected[groupIndex]===optionIndex}" ${result?'disabled':''}>${escape(option)}</button>`).join('<i>/</i>')}</span>`;
    }
    if(segment.kind==='inline_options_display')return `<span class="inline-option-group display-only" data-contract-device="${escape(segment.id)}"><b>${escape(segment.label)}</b>${list(segment.options).map(option=>`<span class="inline-option-copy">${escape(option)}</span>`).join('<i>/</i>')}</span>`;
    if(segment.kind==='position'){
      const rowIndex=list(contract?.choices?.rows).findIndex(row=>row?.cells?.[0]===segment.label),chosen=selected.includes(rowIndex),correct=result?.answer?.includes(rowIndex);
      const state=result?(correct?' correct':chosen?' wrong':''):chosen?' selected':'';
      return `<button class="inline-answer position${state}" type="button" data-contract-device="${escape(segment.id)}" data-question-choice="${rowIndex}" aria-pressed="${chosen}" ${result?'disabled':''}>${escape(segment.label)}</button>`;
    }
    return '';
  }).join('');
  return `<p>${html}</p>`;
}

export function contractChoiceCopyHtml(contract,index,escape,lookupText=null){
  const cells=list(contract?.choices?.rows?.[index]?.cells);
  if(!cells.length)return '';
  const copy=(value,column)=>lookupText?lookupText(value,`choice:${index}:${column}`):escape(value);
  if(contract.kind!=='choice_matrix')return copy(cells[0],0);
  return cells.map((cell,column)=>`<span class="choice-cell" data-choice-column="${column}"><small>${escape(contract.choices.columns[column]||'')}</small>${copy(cell,column)}</span>`).join('');
}

export function contractResponseComplete(contract,values){
  const slots=list(contract?.response?.slots);
  return slots.length>0&&list(values).length===slots.length&&list(values).every(value=>String(value||'').trim());
}

export function contractResponseControlHtml(contract,index,{escape,value='',disabled=false}={}){
  const slot=list(contract?.response?.slots)[index];
  if(!slot)return '';
  const attributes=`data-written-slot="${index}" placeholder="${escape(slot.placeholder)}" ${disabled?'disabled':''} autocomplete="off" spellcheck="false"`;
  return slot.control==='textarea'?`<textarea rows="3" ${attributes}>${escape(value)}</textarea>`:`<input type="text" ${attributes} value="${escape(value)}">`;
}

export function contractRenderCounts(contract){
  return {
    passageDevices:list(contract?.passage?.segments).filter(segment=>segment.kind!=='text').length,
    choiceRows:list(contract?.choices?.rows).length,
    choiceCells:list(contract?.choices?.rows).reduce((total,row)=>total+list(row?.cells).length,0),
    responseSlots:list(contract?.response?.slots).length,
  };
}
