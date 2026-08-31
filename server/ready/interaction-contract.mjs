const text=value=>typeof value==='string'?value.trim():'';
const list=value=>Array.isArray(value)?value:[];
const wordCount=value=>(String(value||'').match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g)||[]).length;
const normalize=value=>text(value).normalize('NFKC').toLowerCase().replace(/[“”‘’'".,!?;:()[\]{}]/g,'').replace(/\s+/g,' ').trim();
const INTERACTION_KINDS=new Set(['choice_list','choice_matrix','inline_options','position_choice','written_response']);
const SEGMENT_KINDS=new Set(['text','annotation','blank','inline_options','position']);
const WRITTEN_LAYOUTS=new Set(['sentence','sentence_parts','short_answers','arrangement','correction','multi_correction','summary']);

export const INTERACTION_CONTRACT_VERSION=1;

export function requiresPassageEvidence(input={}){
  const payload=input&&typeof input==='object'?input:{prompt:input};
  const value=String(payload.prompt||'').replace(/\s+/g,' '),task=String(payload?.writing_guide?.task_text||'').trim();
  const koreanWritingTarget=/[가-힣]/u.test(task)&&/(?:영작|우리말|문장(?:을|으로)?\s*(?:완성|작성))/u.test(value);
  if(koreanWritingTarget)return false;
  return /(?:본문(?:을|에서)|윗글|지문|글을\s*(?:읽고|바탕)|위\s*글)/u.test(value)||/\b(?:based on|according to)\s+(?:the\s+)?(?:passage|text)\b|\bread\s+(?:the\s+)?(?:passage|text)\b/i.test(value);
}

function publicSlot(slot,index){
  return {
    id:text(slot?.id)||`slot-${index+1}`,
    label:text(slot?.label)||`답 ${index+1}`,
    control:slot?.control==='textarea'?'textarea':'text',
    placeholder:text(slot?.placeholder)||'답을 입력하세요',
  };
}

export function publicInteractionContract(value){
  if(!value||typeof value!=='object')return null;
  const passage=value.passage&&typeof value.passage==='object'?value.passage:{};
  const choices=value.choices&&typeof value.choices==='object'?value.choices:{};
  const response=value.response&&typeof value.response==='object'?value.response:{};
  return {
    version:Number(value.version)||0,
    kind:text(value.kind),
    selection:text(value.selection),
    passage:{visible:passage.visible!==false,segments:list(passage.segments).map(segment=>({
      kind:text(segment?.kind),id:text(segment?.id),label:text(segment?.label),text:String(segment?.text||''),options:list(segment?.options).map(text),
    }))},
    choices:{columns:list(choices.columns).map(text),rows:list(choices.rows).map(row=>({cells:list(row?.cells).map(text)}))},
    response:{layout:text(response.layout),slots:list(response.slots).map(publicSlot),targetIds:list(response.targetIds).map(text)},
  };
}

export function interactionContractErrors(payload={},type='multiple_choice'){
  const contract=payload?.spec?.interaction,errors=[];
  if(!contract||typeof contract!=='object')return ['interaction contract is missing'];
  if(Number(contract.version)!==INTERACTION_CONTRACT_VERSION)errors.push('unknown interaction contract version');
  if(!INTERACTION_KINDS.has(text(contract.kind)))errors.push('unknown interaction kind');
  const segments=list(contract?.passage?.segments);
  if(typeof contract?.passage?.visible!=='boolean')errors.push('interaction passage visibility is not explicit');
  if(!segments.length)errors.push('interaction passage segments are missing');
  const deviceIds=new Set(),deviceLabels=[];
  let rendered='';
  for(const [index,segment] of segments.entries()){
    const kind=text(segment?.kind),id=text(segment?.id),label=text(segment?.label),copy=String(segment?.text||'');
    if(!SEGMENT_KINDS.has(kind))errors.push(`passage segment ${index+1} has unknown kind`);
    if(kind==='text'){if(!copy)errors.push(`passage segment ${index+1} is empty`);rendered+=copy;continue;}
    if(!id||deviceIds.has(id))errors.push(`passage device ${index+1} has a duplicate or missing id`);else deviceIds.add(id);
    if(label)deviceLabels.push(label);
    if(kind==='annotation'&&!copy)errors.push(`annotation ${id||index+1} has no exact text`);
    if(kind==='blank'&&copy)errors.push(`blank ${id||index+1} exposes answer text`);
    if(kind==='inline_options'&&list(segment?.options).length<2)errors.push(`inline option ${id||index+1} is incomplete`);
    rendered+=copy;
  }
  const approved=text(payload.set_text||payload.variant_text||payload.passage_text);
  const comparable=value=>String(value||'').replace(/\s+/g,' ').trim();
  const sourceFromSegments=segments.map(segment=>segment.kind==='blank'?'':String(segment?.text||'')).join('');
  if(!approved)errors.push('student passage is missing');
  if(!sourceFromSegments&&!segments.some(segment=>segment.kind==='blank'))errors.push('interaction passage renders no source text');
  if(/[가-힣]/.test(sourceFromSegments))errors.push('interaction passage contains Korean text');
  if(/(?:\([A-H]\)|[ⓐ-ⓩ])\s*\[[^\]]+\/[^\]]+\]/.test(sourceFromSegments))errors.push('interaction passage contains inactive inline-choice apparatus');

  if(type==='multiple_choice'){
    if(!['choice_list','choice_matrix','inline_options','position_choice'].includes(text(contract.kind)))errors.push('multiple choice requires a choice interaction');
    if(!['single','multi'].includes(text(contract.selection)))errors.push('multiple choice selection mode is missing');
    const rows=list(contract?.choices?.rows),choices=list(payload.choices),columns=list(contract?.choices?.columns);
    if(rows.length!==choices.length)errors.push('choice row count does not match choices');
    const expectedCells=contract.kind==='choice_matrix'?columns.length:1;
    if(contract.kind==='choice_matrix'&&expectedCells<2)errors.push('choice matrix columns are missing');
    rows.forEach((row,index)=>{
      const cells=list(row?.cells).map(text);
      if(cells.length!==expectedCells||cells.some(cell=>!cell))errors.push(`choice row ${index+1} cell contract is incomplete`);
      if(cells.join(' ')!==text(choices[index]))errors.push(`choice row ${index+1} does not equal the publisher choice`);
    });
    const answers=list(payload.answer).map(Number);
    if(!answers.length||answers.some(index=>!Number.isInteger(index)||index<0||index>=rows.length))errors.push('interaction answer indexes are invalid');
    if(contract.selection==='single'&&answers.length!==1)errors.push('single selection does not match answer key');
    if(contract.selection==='multi'&&answers.length<2)errors.push('multi selection does not match answer key');
    if(contract.kind==='inline_options'){
      const groups=segments.filter(segment=>segment.kind==='inline_options');
      if(!groups.length)errors.push('inline options interaction has no passage groups');
      if(rows.some(row=>list(row?.cells).length!==1))errors.push('inline options publisher choices must remain one complete combination per row');
    }
    if(contract.kind==='position_choice'){
      const positions=segments.filter(segment=>segment.kind==='position');
      if(!positions.length)errors.push('position choice has no passage positions');
      const positionLabels=new Set(positions.map(item=>text(item.label)));
      if(rows.some(row=>!positionLabels.has(text(row?.cells?.[0]))))errors.push('position choices do not match passage positions');
    }
    const promptLabels=promptDeviceLabels(payload.prompt);
    const passageLabels=new Set(segments.filter(segment=>segment.kind!=='text').map(segment=>text(segment.label)).filter(Boolean));
    if(promptLabels.some(label=>!passageLabels.has(label)))errors.push('prompt devices do not match passage devices');
    if(contract.kind==='choice_matrix'&&JSON.stringify(columns)!==JSON.stringify(promptLabels))errors.push('choice matrix columns do not match prompt devices');
    if(['choice_matrix','inline_options'].includes(contract.kind)){
      const activeLabels=contract.kind==='choice_matrix'?segments.filter(segment=>segment.kind==='blank').map(item=>text(item.label)):segments.filter(segment=>segment.kind==='inline_options').map(item=>text(item.label));
      if(JSON.stringify(activeLabels)!==JSON.stringify(contract.kind==='choice_matrix'?columns:promptLabels))errors.push('prompt devices do not match passage devices');
    }
  }else if(type==='written_response'){
    if(text(contract.kind)!=='written_response')errors.push('written response requires written_response interaction');
    if(text(contract.selection)!=='none')errors.push('written response selection must be none');
    const layout=text(contract?.response?.layout),slots=list(contract?.response?.slots),accepted=list(payload.accepted_answers);
    if(!WRITTEN_LAYOUTS.has(layout))errors.push('written response layout is missing');
    if(requiresPassageEvidence(payload)&&contract?.passage?.visible!==true)errors.push('written prompt requires visible passage evidence');
    if(slots.length!==accepted.length)errors.push('interaction response slots do not match answer slots');
    const ids=new Set();
    slots.forEach((slot,index)=>{
      const id=text(slot?.id),label=text(slot?.label),control=text(slot?.control),placeholder=text(slot?.placeholder);
      if(!id||ids.has(id))errors.push(`response slot ${index+1} has a duplicate or missing id`);else ids.add(id);
      if(!label)errors.push(`response slot ${index+1} label is missing`);
      if(!['text','textarea'].includes(control))errors.push(`response slot ${index+1} control is invalid`);
      if(!placeholder)errors.push(`response slot ${index+1} placeholder is missing`);
      const variants=Array.isArray(accepted[index])?accepted[index]:[accepted[index]],variantCounts=variants.map(wordCount),counts=new Set(variantCounts);
      if(!variants.length||variantCounts.some(count=>count<1))errors.push(`response slot ${index+1} has no lexical publisher answer`);
      if(!Number.isInteger(Number(slot?.wordCount))||Number(slot?.wordCount)<1)errors.push(`response slot ${index+1} word count is invalid`);
      else if(!counts.size||!counts.has(Number(slot.wordCount)))errors.push(`response slot ${index+1} word count does not match publisher answer`);
    });
    const guideKind=text(payload?.writing_guide?.kind).replace(/-/g,'_');
    const expectedLayout=guideKind==='summary'?'summary':guideKind==='arrangement'?'arrangement':guideKind==='multi_correction'?'multi_correction':guideKind==='correction'?'correction':slots.length>1?(list(payload?.writing_guide?.targets).length?'short_answers':'sentence_parts'):'sentence';
    if(layout!==expectedLayout)errors.push(`written response layout ${layout||'?'} does not match explicit guide ${expectedLayout}`);
    if(['correction','multi_correction','short_answers'].includes(layout)&&list(contract?.response?.targetIds).length!==slots.length)errors.push('written target count does not match response controls');
  }
  return [...new Set(errors)];
}

export function promptDeviceLabels(prompt){
  const source=String(prompt||''),labels=[];
  for(const match of source.match(/\([A-H]\)|[ⓐ-ⓩ㉠-㉭]/g)||[])if(!labels.includes(match))labels.push(match);
  return labels;
}

function normalizedCombination(value){return normalize(value).replace(/[^a-z0-9]+/g,'');}
function inlineExpected(contract,payload){
  const groups=list(contract?.passage?.segments).filter(segment=>segment.kind==='inline_options'),answerIndex=Number(list(payload.answer)[0]),choice=text(payload?.choices?.[answerIndex]);
  if(!groups.length||!choice)return [];
  const expected=normalizedCombination(choice),selected=[];
  function visit(index,parts){
    if(index===groups.length)return normalizedCombination(parts.join(' '))===expected;
    for(let option=0;option<list(groups[index].options).length;option+=1)if(visit(index+1,[...parts,groups[index].options[option]])){selected[index]=option;return true;}
    return false;
  }
  return visit(0,[])?selected:[];
}

export function deterministicGrade(payload={},type='multiple_choice',submission={}){
  const contract=payload?.spec?.interaction||{};
  if(type==='multiple_choice'){
    if(contract.kind==='inline_options'){
      const selected=list(submission.inlineSelected).map(Number),expected=inlineExpected(contract,payload);
      const groups=list(contract?.passage?.segments).filter(segment=>segment.kind==='inline_options');
      const valid=selected.length===groups.length&&selected.every((value,index)=>Number.isInteger(value)&&value>=0&&value<list(groups[index]?.options).length);
      return {valid,correct:valid&&selected.length===expected.length&&selected.every((value,index)=>value===expected[index]),answer:expected};
    }
    const selected=list(submission.selected).map(Number).sort((a,b)=>a-b),expected=list(payload.answer).map(Number).sort((a,b)=>a-b);
    const valid=selected.length>0&&selected.every(value=>Number.isInteger(value)&&value>=0&&value<list(contract?.choices?.rows).length)&&(contract.selection==='multi'||selected.length===1);
    return {valid,correct:valid&&selected.length===expected.length&&selected.every((value,index)=>value===expected[index]),answer:expected};
  }
  const responses=list(submission.responses).map(value=>String(value??'').trim()),accepted=list(payload.accepted_answers),sets=list(payload.accepted_response_sets);
  if(!responses.length||responses.length!==accepted.length)return {valid:false,correct:false,answer:accepted};
  const correct=sets.length?sets.some(set=>list(set).length===responses.length&&list(set).every((candidate,index)=>normalize(candidate)===normalize(responses[index]))):responses.every((value,index)=>(Array.isArray(accepted[index])?accepted[index]:[accepted[index]]).some(candidate=>normalize(candidate)===normalize(value)));
  return {valid:true,correct,answer:accepted};
}

export function publisherRoundTripErrors(payload={},type='multiple_choice'){
  const contract=payload?.spec?.interaction,errors=[];
  if(!contract)return ['publisher round-trip has no interaction contract'];
  const rendered={
    passageDevices:list(contract?.passage?.segments).filter(segment=>segment.kind!=='text').length,
    choiceRows:list(contract?.choices?.rows).length,
    choiceCells:list(contract?.choices?.rows).reduce((total,row)=>total+list(row?.cells).length,0),
    responseSlots:list(contract?.response?.slots).length,
  };
  let submission;
  if(type==='multiple_choice')submission=contract.kind==='inline_options'?{inlineSelected:inlineExpected(contract,payload)}:{selected:list(payload.answer)};
  else {
    const set=list(payload.accepted_response_sets)[0],accepted=list(payload.accepted_answers);
    submission={responses:(Array.isArray(set)?set:accepted.map(slot=>Array.isArray(slot)?slot[0]:slot)).map(value=>String(value??''))};
  }
  const grade=deterministicGrade(payload,type,submission);
  if(!grade.valid||!grade.correct)errors.push('publisher answer does not round-trip through the deterministic grader');
  if(type==='multiple_choice'&&!rendered.choiceRows)errors.push('round-trip rendered no choice rows');
  if(type==='written_response'&&rendered.responseSlots!==list(submission.responses).length)errors.push('round-trip response controls do not serialize every publisher answer slot');
  if(contract.kind==='choice_matrix'&&rendered.choiceCells!==rendered.choiceRows*list(contract?.choices?.columns).length)errors.push('round-trip choice matrix cell count is inconsistent');
  if(contract.kind==='inline_options'&&rendered.passageDevices!==list(submission.inlineSelected).length)errors.push('round-trip inline controls do not serialize every publisher option');
  return [...new Set(errors)];
}
