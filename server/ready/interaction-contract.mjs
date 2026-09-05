import {normalizeDeterministicAnswer as normalize} from '../../ready/deterministic-grading.js';

const text=value=>typeof value==='string'?value.trim():'';
const list=value=>Array.isArray(value)?value:[];
const wordCount=value=>(String(value||'').match(/[A-Za-z]+(?:['’][A-Za-z]+)?|[가-힣]+|\d+(?:,\d{3})*(?:\.\d+)?/g)||[]).length;
const INTERACTION_KINDS=new Set(['choice_list','choice_matrix','inline_options','position_choice','written_response']);
const SEGMENT_KINDS=new Set(['text','annotation','blank','inline_options','inline_options_display','position']);
const WRITTEN_LAYOUTS=new Set(['sentence','sentence_cloze','sentence_parts','short_answers','arrangement','correction','multi_correction','summary']);
const TEMPLATE_KINDS=new Set(['text','slot']);

const koreanCharacters=value=>(String(value||'').match(/[가-힣]+/gu)||[]).join('');
const representationBlockText=block=>text(block?.display_text||block?.text||block?.canonical_text);

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
    wordCount:Number(slot?.wordCount)||null,
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
    response:{layout:text(response.layout),slots:list(response.slots).map(publicSlot),targetIds:list(response.targetIds).map(text),template:list(response.template).map(item=>({kind:text(item?.kind),text:item?.kind==='text'?String(item?.text||''):'',slotIndex:item?.kind==='slot'?Number(item?.slotIndex):null}))},
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
    if(['inline_options','inline_options_display'].includes(kind)&&list(segment?.options).length<2)errors.push(`inline option ${id||index+1} is incomplete`);
    rendered+=copy;
  }
  const approved=text(payload.set_text||payload.variant_text||payload.passage_text);
  const comparable=value=>String(value||'').replace(/\s+/g,' ').trim();
  const sourceFromSegments=segments.map(segment=>segment.kind==='blank'?'':String(segment?.text||'')).join('');
  if(!approved)errors.push('student passage is missing');
  if(!sourceFromSegments&&!segments.some(segment=>segment.kind==='blank'))errors.push('interaction passage renders no source text');
  const renderedKorean=koreanCharacters(sourceFromSegments);
  if(renderedKorean){
    const publisherKorean=koreanCharacters(list(payload?.representation?.source_blocks).filter(block=>['korean_insert','korean_target'].includes(text(block?.role))).map(representationBlockText).join(''));
    if(!publisherKorean||renderedKorean!==publisherKorean)errors.push('interaction passage contains Korean text that is not owned by a publisher Korean source block');
  }
  if(/(?:\([A-H]\)|[ⓐ-ⓩ])\s*\[[^\]]+\/[^\]]+\]/.test(sourceFromSegments))errors.push('interaction passage contains inactive inline-choice apparatus');

  if(type==='multiple_choice'){
    if(!['choice_list','choice_matrix','inline_options','position_choice'].includes(text(contract.kind)))errors.push('multiple choice requires a choice interaction');
    if(!['single','multi'].includes(text(contract.selection)))errors.push('multiple choice selection mode is missing');
    const rows=list(contract?.choices?.rows),choices=list(payload.choices),columns=list(contract?.choices?.columns);
    const approvedInlineApparatus=/(?:\([A-H]\)|[ⓐ-ⓩ])\s*\[[^\]]+\/[^\]]+\]/.test(approved);
    if(approvedInlineApparatus&&!segments.some(segment=>['inline_options','inline_options_display'].includes(segment.kind)))errors.push('inline-choice passage apparatus is not connected to the publisher choices');
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
    const promptLabels=promptDeviceLabels(payload.prompt),blocksById=new Map(list(payload?.representation?.source_blocks).map(block=>[text(block?.id),block]));
    const auxiliaryPointerLabels=list(payload?.representation?.pointers).filter(pointer=>{
      const owner=text(blocksById.get(text(pointer?.block_id))?.role);
      return ['summary','word_bank'].includes(owner)&&text(pointer?.confidence)!=='unresolved';
    }).map(pointer=>text(pointer?.label)).filter(Boolean);
    const passageLabels=new Set([...segments.filter(segment=>segment.kind!=='text').map(segment=>text(segment.label)).filter(Boolean),...auxiliaryPointerLabels]);
    if(promptLabels.some(label=>!passageLabels.has(label)))errors.push('prompt devices do not match passage devices');
    if(contract.kind==='choice_matrix'&&JSON.stringify(columns)!==JSON.stringify(promptLabels))errors.push('choice matrix columns do not match prompt devices');
    if(['choice_matrix','inline_options'].includes(contract.kind)){
      const activeLabels=contract.kind==='choice_matrix'?segments.filter(segment=>segment.kind==='blank').map(item=>text(item.label)):segments.filter(segment=>segment.kind==='inline_options').map(item=>text(item.label));
      if(JSON.stringify(activeLabels)!==JSON.stringify(contract.kind==='choice_matrix'?columns:promptLabels))errors.push('prompt devices do not match passage devices');
    }
    const displayGroups=segments.filter(segment=>segment.kind==='inline_options_display');
    if(displayGroups.length){
      if(contract.kind!=='choice_list')errors.push('display-only inline options require publisher choice selection');
      if(JSON.stringify(displayGroups.map(item=>text(item.label)))!==JSON.stringify(promptLabels))errors.push('display-only inline option labels do not match the prompt');
      const normalized=value=>normalize(value).replace(/[^a-z0-9]+/g,'');
      for(const [index,row] of rows.entries()){
        const choice=text(row?.cells?.[0]),expected=normalized(choice);
        let matched=false;
        const visit=(group,parts)=>{if(matched)return;if(group===displayGroups.length){matched=normalized(parts.join(' '))===expected;return;}for(const option of list(displayGroups[group].options))visit(group+1,[...parts,option]);};
        visit(0,[]);
        if(!matched)errors.push(`choice row ${index+1} does not encode one option from every inline group`);
      }
    }
    if(taxonomyStartsWithBlank(payload)&&!segments.some(segment=>segment.kind==='blank'))errors.push('blank question has no explicit blank passage device');
    const numericPointers=rows.length&&rows.every((row,index)=>text(row?.cells?.[0])===String(index+1));
    const annotationPointers=segments.filter(segment=>segment.kind==='annotation').map(segment=>text(segment.label));
    const circledDigits=['①','②','③','④','⑤','⑥','⑦','⑧'];
    if(contract.kind==='choice_list'&&numericPointers&&!rows.every((_row,index)=>annotationPointers.includes(circledDigits[index])))errors.push('numeric pointer choices must be reconstructed as semantic publisher choices');
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
    const expectedLayout=guideKind==='sentence_cloze'?'sentence_cloze':guideKind==='summary'?'summary':guideKind==='arrangement'?'arrangement':guideKind==='multi_correction'?'multi_correction':guideKind==='correction'?'correction':slots.length>1?(list(payload?.writing_guide?.targets).length?'short_answers':'sentence_parts'):'sentence';
    if(layout!==expectedLayout)errors.push(`written response layout ${layout||'?'} does not match explicit guide ${expectedLayout}`);
    if(['sentence_cloze','summary'].includes(layout)){
      const template=list(contract?.response?.template),slotIndexes=template.filter(item=>text(item?.kind)==='slot').map(item=>Number(item?.slotIndex));
      if(!template.length||template.some(item=>!TEMPLATE_KINDS.has(text(item?.kind))))errors.push(`written ${layout} template is missing or invalid`);
      if(slotIndexes.length!==slots.length||slotIndexes.some((value,index)=>value!==index))errors.push(`written ${layout} template slots do not match response controls`);
      if(!template.some(item=>text(item?.kind)==='text'&&wordCount(item?.text)>0))errors.push(`written ${layout} template has no fixed context`);
      if(layout==='summary'){
        const contracted=template.map(item=>text(item?.kind)==='slot'?'_____':String(item?.text||'')).join('');
        const normalizedFrame=value=>String(value||'').replace(/[_＿]{3,}/g,'_____').replace(/\s+/g,' ').trim();
        if(normalizedFrame(contracted)!==normalizedFrame(payload.summary_text))errors.push('written summary template does not equal the approved summary frame');
      }
    }
    if(layout==='sentence_cloze'){
      const template=list(contract?.response?.template);
      const answerValues=accepted.map(slot=>String((Array.isArray(slot)?slot[0]:slot)||''));
      const reconstructed=template.map(item=>text(item?.kind)==='slot'?answerValues[Number(item.slotIndex)]||'':String(item?.text||'')).join('');
      const publisherFull=text(payload?.writing_guide?.publisher_answer);
      if(!publisherFull||normalize(reconstructed)!==normalize(publisherFull))errors.push('written cloze template does not reconstruct publisher answer');
    }
    if(['correction','multi_correction','short_answers'].includes(layout)&&list(contract?.response?.targetIds).length!==slots.length)errors.push('written target count does not match response controls');
  }
  return [...new Set(errors)];
}

export function promptDeviceLabels(prompt){
  const source=String(prompt||''),labels=[];
  for(const match of source.match(/\([A-H]\)|[ⓐ-ⓩ㉠-㉭]/g)||[])if(!labels.includes(match))labels.push(match);
  return labels;
}

function taxonomyStartsWithBlank(payload){return text(payload?.taxonomy||payload?.spec?.taxonomy).startsWith('blank_');}

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

export function deterministicClientContract(payload={},type='multiple_choice'){
  const contract=payload?.spec?.interaction||{};
  if(type==='multiple_choice')return {
    mode:'deterministic',kind:contract.kind==='inline_options'?'inline_options':'choice',selection:text(contract.selection)||'single',
    answer:contract.kind==='inline_options'?inlineExpected(contract,payload):list(payload.answer).map(Number),
  };
  return {
    mode:'deterministic_then_ai',kind:'written',acceptedAnswers:list(payload.accepted_answers),acceptedResponseSets:list(payload.accepted_response_sets),
  };
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
