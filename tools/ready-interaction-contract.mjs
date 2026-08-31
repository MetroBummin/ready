import { INTERACTION_CONTRACT_VERSION, interactionContractErrors, promptDeviceLabels, publisherRoundTripErrors, requiresPassageEvidence } from '../server/ready/interaction-contract.mjs';

const text=value=>String(value||'').trim();
const list=value=>Array.isArray(value)?value:[];
const escapeRegExp=value=>String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function pushText(segments,value){
  if(!value)return;
  const previous=segments.at(-1);
  if(previous?.kind==='text')previous.text+=value;else segments.push({kind:'text',text:value});
}

function tokenizePassage(source,devices){
  const ordered=[...devices].sort((a,b)=>a.start-b.start||b.end-a.end),segments=[];
  let cursor=0;
  for(const device of ordered){
    if(device.start<cursor)throw new Error(`overlapping passage devices ${device.id}`);
    pushText(segments,source.slice(cursor,device.start));
    segments.push({kind:device.kind,id:device.id,label:device.label||'',text:device.text||'',...(device.options?{options:device.options}: {})});
    cursor=device.end;
  }
  pushText(segments,source.slice(cursor));
  return segments;
}

function blankDevices(source){
  const devices=[];
  for(const match of source.matchAll(/(?:\([A-H]\)|[ⓐ-ⓩ㉠-㉭])?\s*[_＿]{3,}/g)){
    const raw=match[0],label=raw.match(/\([A-H]\)|[ⓐ-ⓩ㉠-㉭]/)?.[0]||'';
    devices.push({kind:'blank',id:label||`blank-${devices.length+1}`,label,text:'',start:match.index,end:(match.index||0)+raw.length});
  }
  return devices;
}

function inlineDevices(source){
  const devices=[];
  for(const match of source.matchAll(/(\([A-H]\)|[ⓐ-ⓩ])\s*\[([^\]]+)\]/g)){
    const options=match[2].split('/').map(text).filter(Boolean);
    if(options.length<2)continue;
    devices.push({kind:'inline_options',id:match[1],label:match[1],text:'',options,start:match.index,end:(match.index||0)+match[0].length});
  }
  return devices;
}

function positionDevices(source,choiceLabels){
  const allowed=new Set(choiceLabels.map(text)),devices=[];
  const alternatives=[...allowed].filter(Boolean).sort((a,b)=>b.length-a.length).map(escapeRegExp);
  if(!alternatives.length)return devices;
  for(const match of source.matchAll(new RegExp(alternatives.join('|'),'g'))){
    const label=match[0];
    devices.push({kind:'position',id:label,label,text:'',start:match.index,end:(match.index||0)+label.length});
  }
  return devices;
}

function annotationDevices(source,ranges){
  const devices=[],used=[];
  for(const [index,range] of ranges.entries()){
    const label=text(range?.label),copy=text(range?.text),canonical=text(range?.canonical_text||range?.canonicalText||copy);
    if(!label||!copy)throw new Error(`annotation ${index+1} is incomplete`);
    const labelled=new RegExp(`${escapeRegExp(label)}\\s*${escapeRegExp(copy).replace(/\\ /g,'\\s+')}`,'i').exec(source);
    let start,end;
    if(labelled){start=labelled.index;end=start+labelled[0].length;}
    else {
      const candidates=[...source.matchAll(new RegExp(escapeRegExp(copy).replace(/\\ /g,'\\s+'),'gi'))].filter(match=>!used.some(row=>(match.index||0)<row.end&&(match.index||0)+match[0].length>row.start));
      if(candidates.length!==1)throw new Error(`annotation ${label} is not one exact passage span`);
      start=candidates[0].index;end=start+candidates[0][0].length;
    }
    used.push({start,end});devices.push({kind:'annotation',id:label,label,text:copy,canonicalText:canonical,start,end});
  }
  return devices;
}

function rowsFromChoices(payload,cells=null){
  const choices=list(payload.choices).map(text);
  if(cells)return cells.map(row=>({cells:row.map(text)}));
  return choices.map(choice=>({cells:[choice]}));
}

function combinationRows(groups,choices){
  const normalized=value=>text(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'');
  function resolve(choice){
    const expected=normalized(choice);
    function visit(index,parts){
      if(index===groups.length)return normalized(parts.join(' '))===expected?parts:null;
      for(const option of groups[index].options){const found=visit(index+1,[...parts,option]);if(found)return found;}
      return null;
    }
    return visit(0,[]);
  }
  const rows=choices.map(resolve);
  return rows.every(Boolean)?rows:null;
}

function writtenLayout(payload){
  const guide=payload.writing_guide||{},kind=text(guide.kind).replace(/-/g,'_'),slots=list(payload.response_slots),targets=list(guide.targets||payload.target_ranges);
  if(kind==='sentence_cloze')return 'sentence_cloze';
  if(kind==='summary')return 'summary';
  if(kind==='arrangement')return 'arrangement';
  if(kind==='multi_correction')return 'multi_correction';
  if(kind==='correction')return 'correction';
  if(slots.length>1)return targets.length?'short_answers':'sentence_parts';
  return 'sentence';
}

function writtenSlots(payload,layout){
  const guide=payload.writing_guide||{};
  return list(payload.response_slots).map((slot,index)=>({
    id:`slot-${index+1}`,
    label:text(slot?.label)||text(guide.slot_labels?.[index])||`답 ${index+1}`,
    control:layout==='sentence'?'textarea':'text',
    placeholder:layout==='correction'||layout==='multi_correction'?'고친 표현을 입력하세요':layout==='summary'?'빈칸의 답을 입력하세요':layout==='arrangement'?'배열한 문장을 입력하세요':'답을 입력하세요',
    wordCount:Number(slot?.word_count)||null,
  }));
}

function answerFrameTemplate(source,slots,label){
  const matches=[...String(source||'').matchAll(/[_＿]{3,}/g)];
  if(matches.length!==slots.length)throw new Error(`${label} blank count ${matches.length} does not match response slots ${slots.length}`);
  const template=[];
  let cursor=0;
  matches.forEach((match,index)=>{
    pushText(template,String(source).slice(cursor,match.index));
    template.push({kind:'slot',slotIndex:index});
    cursor=(match.index||0)+match[0].length;
  });
  pushText(template,String(source).slice(cursor));
  return template;
}

export function compileInteractionContract(payload={},type='multiple_choice'){
  if(!payload.spec||typeof payload.spec!=='object')throw new Error('explicit Question render spec is missing');
  const source=text(payload.set_text||payload.variant_text||payload.passage_text),taxonomy=text(payload.taxonomy),selection=payload.multi_select===true||list(payload.answer).length>1?'multi':'single';
  if(!source)throw new Error('student passage is missing');
  let devices=[],kind,columns=[],rows=[];
  if(type==='written_response'){
    const ranges=list(payload.target_ranges||payload?.writing_guide?.targets),layout=writtenLayout(payload);
    devices=ranges.length?annotationDevices(source,ranges):[];
    const sourceRequired=requiresPassageEvidence(payload),hideAnswerOnlySource=text(payload?.writing_guide?.task_text)&&['sentence','sentence_cloze','sentence_parts'].includes(layout);
    const slots=writtenSlots(payload,layout),template=layout==='sentence_cloze'?list(payload?.writing_guide?.answer_template):layout==='summary'?answerFrameTemplate(payload.summary_text,slots,'summary'):[];
    payload.spec.interaction={version:INTERACTION_CONTRACT_VERSION,kind:'written_response',selection:'none',passage:{visible:sourceRequired||!hideAnswerOnlySource,segments:tokenizePassage(source,devices)},choices:{columns:[],rows:[]},response:{layout,slots,targetIds:devices.map(item=>item.id),template}};
    return payload.spec.interaction;
  }

  const choices=list(payload.choices).map(text),promptLabels=promptDeviceLabels(payload.prompt);
  if(taxonomy==='sentence_insertion'){
    kind='position_choice';devices=positionDevices(source,choices);rows=rowsFromChoices(payload);
  }else {
    const inline=inlineDevices(source),blanks=blankDevices(source),ranges=list(payload.target_ranges);
    const combinations=inline.length?combinationRows(inline,choices):null;
    if(inline.length&&combinations){kind='choice_list';devices=inline.map(device=>({...device,kind:'inline_options_display'}));rows=rowsFromChoices(payload);}
    else if(blanks.length){
      devices=blanks;
      if(promptLabels.length>1){
        kind='choice_matrix';columns=promptLabels;
        const stored=list(payload.choice_parts).map(row=>list(row).map(text));
        if(stored.length!==choices.length)throw new Error('choice matrix requires explicit choice_parts');
        rows=rowsFromChoices(payload,stored);
      }else {kind='choice_list';rows=rowsFromChoices(payload);}
    }else if(ranges.length){kind='choice_list';devices=annotationDevices(source,ranges);rows=rowsFromChoices(payload);}
    else {kind='choice_list';rows=rowsFromChoices(payload);}
  }
  payload.spec.interaction={version:INTERACTION_CONTRACT_VERSION,kind,selection,passage:{visible:true,segments:tokenizePassage(source,devices)},choices:{columns,rows},response:{layout:'',slots:[],targetIds:[]}};
  return payload.spec.interaction;
}

export function compileAndValidateInteraction(payload={},type='multiple_choice'){
  const errors=[];
  try{compileInteractionContract(payload,type);}catch(error){errors.push(error.message||String(error));}
  if(!errors.length)errors.push(...interactionContractErrors(payload,type),...publisherRoundTripErrors(payload,type));
  return [...new Set(errors)];
}
