const text=value=>String(value??'').trim();
const list=value=>Array.isArray(value)?value:[];
const normalized=value=>text(value).normalize('NFKC').replace(/[\s\u00a0]+/g,' ');

export const QUESTION_REPRESENTATION_VERSION=1;
export const SOURCE_BLOCK_KINDS=Object.freeze(['canonical_span','publisher_text']);
export const POINTER_KINDS=Object.freeze(['span','blank','point']);
export const POINTER_CONFIDENCE=Object.freeze(['high','medium','low','unresolved']);
export const RESPONSE_TYPES=Object.freeze(['single_choice','multiple_choice','written_text','ordering']);

function tokens(value){
  const source=String(value??''),out=[];
  for(const match of source.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu))out.push({value:match[0].normalize('NFKC').toLowerCase().replace('’',"'"),start:match.index,end:match.index+match[0].length});
  return out;
}

function lcsMatches(left,right){
  const rows=left.length+1,cols=right.length+1,table=Array.from({length:rows},()=>new Uint16Array(cols));
  for(let i=1;i<rows;i+=1)for(let j=1;j<cols;j+=1)table[i][j]=left[i-1].value===right[j-1].value?table[i-1][j-1]+1:Math.max(table[i-1][j],table[i][j-1]);
  const matches=[];let i=left.length,j=right.length;
  while(i&&j){
    if(left[i-1].value===right[j-1].value){matches.push([i-1,j-1]);i-=1;j-=1;}
    else if(table[i-1][j]>=table[i][j-1])i-=1;else j-=1;
  }
  return matches.reverse();
}

function editDistance(left,right){
  let previous=Uint16Array.from({length:right.length+1},(_,index)=>index);
  for(let i=1;i<=left.length;i+=1){
    const current=new Uint16Array(right.length+1);current[0]=i;
    for(let j=1;j<=right.length;j+=1)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(left[i-1].value===right[j-1].value?0:1));
    previous=current;
  }
  return previous[right.length];
}

export function alignPublisherText(publisherText,canonicalText,{passageId=''}={}){
  const publisher=tokens(publisherText),canonical=tokens(canonicalText);
  let exactIndex=-1;
  if(publisher.length)for(let candidate=0;candidate<=canonical.length-publisher.length;candidate+=1){if(publisher.every((token,index)=>token.value===canonical[candidate+index]?.value)){exactIndex=candidate;break;}}
  const matches=exactIndex>=0?publisher.map((_token,index)=>[index,exactIndex+index]):lcsMatches(publisher,canonical);
  if(!publisher.length||!canonical.length||!matches.length)return {mode:'publisher_text',confidence:'low',passage_id:passageId,coverage:0,canonical_coverage:0,edit_ratio:1,mutation_count:0,matched_tokens:0,fallback_reason:'no deterministic token alignment'};
  const first=matches[0][1],last=matches.at(-1)[1],span=canonical.slice(first,last+1),distance=editDistance(publisher,span),coverage=matches.length/publisher.length,canonicalCoverage=matches.length/span.length,editRatio=distance/Math.max(publisher.length,span.length),start=canonical[first].start,end=canonical[last].end;
  const exact=publisher.length===span.length&&publisher.every((token,index)=>token.value===span[index]?.value);
  const clean=matches.length>=8&&coverage>=0.72&&canonicalCoverage>=0.72&&editRatio<=0.28;
  const mode=exact?'canonical_span':clean?'local_mutation':'publisher_text';
  const confidence=exact?'high':clean&&(coverage>=0.88&&editRatio<=0.14)?'high':clean?'medium':'low';
  return {mode,confidence,passage_id:passageId,canonical_start:clean||exact?start:null,canonical_end:clean||exact?end:null,coverage:Number(coverage.toFixed(4)),canonical_coverage:Number(canonicalCoverage.toFixed(4)),edit_ratio:Number(editRatio.toFixed(4)),mutation_count:exact?0:distance,matched_tokens:matches.length,fallback_reason:mode==='publisher_text'?'alignment is broad, reordered, or too heavily rewritten':''};
}

export function classifyBodyQuestion(question,canonicalText,{minimumMatchedTokens=8}={}){
  const alignments=list(question?.source_blocks).map(block=>alignPublisherText(restorePublisherText(block?.text,block?.mutations),canonicalText));
  const body=alignments.some(item=>item.mode!=='publisher_text'&&item.matched_tokens>=minimumMatchedTokens);
  return {body_question:body,alignments,exclusion_reason:body?'':'no source block has a clean deterministic canonical alignment'};
}

function replaceOccurrence(source,from,to,occurrence=0){
  if(!from)return null;
  let cursor=0,index=-1;
  for(let count=0;count<=occurrence;count+=1){index=source.indexOf(from,cursor);if(index<0)return null;cursor=index+from.length;}
  return `${source.slice(0,index)}${to}${source.slice(index+from.length)}`;
}

export function restorePublisherText(source,mutations){
  let output=String(source??'');
  for(const mutation of [...list(mutations)].reverse()){
    const restored=replaceOccurrence(output,String(mutation?.publisher??''),String(mutation?.canonical??''),Number(mutation?.publisher_occurrence)||0);
    if(restored===null)return output;
    output=restored;
  }
  return output;
}

export function buildQuestionRepresentation(extracted,{passageId,canonicalText}){
  const aligned=list(extracted?.source_blocks).map(block=>{
    const restored=restorePublisherText(block?.text,block?.mutations),alignment=alignPublisherText(restored,canonicalText,{passageId});
    if(list(block?.mutations).length&&alignment.mode!=='publisher_text'){alignment.mode='local_mutation';alignment.mutation_count=list(block.mutations).length;}
    return {block,restored,alignment};
  });
  const sourceBlocks=aligned.map(({block,restored,alignment})=>{
    if(block?.force_publisher_text||alignment.mode==='publisher_text')return {id:text(block?.id),kind:'publisher_text',role:text(block?.role),label:text(block?.label),text:String(block?.text??''),alignment};
    const exactStart=String(canonicalText).indexOf(restored),start=exactStart>=0?exactStart:Number(alignment.canonical_start),end=exactStart>=0?exactStart+restored.length:Number(alignment.canonical_end),canonical=String(canonicalText).slice(start,end);
    return {id:text(block?.id),kind:'canonical_span',role:text(block?.role),label:text(block?.label),passage_id:passageId,start,end,canonical_text:canonical,display_text:String(block?.text??''),mutations:list(block?.mutations),alignment};
  });
  return {
    version:QUESTION_REPRESENTATION_VERSION,
    source_question_identity:text(extracted?.source_question_identity),
    independent_prompt_count:Number(extracted?.independent_prompt_count)||1,
    source_blocks:sourceBlocks,
    prompt:text(extracted?.prompt),
    pointers:list(extracted?.pointers),
    response:extracted?.response||{},
    answer:extracted?.answer||{},
    explanation:extracted?.explanation||null,
    qa:{body_question:sourceBlocks.some(block=>block.kind==='canonical_span'),canonical_alignment_confidence:sourceBlocks.some(block=>block?.alignment?.confidence==='high')?'high':sourceBlocks.some(block=>block?.alignment?.confidence==='medium')?'medium':'low'},
  };
}

function applyMutations(source,mutations,direction='forward'){
  let output=normalized(source),items=direction==='forward'?list(mutations):[...list(mutations)].reverse();
  for(const mutation of items){
    const from=normalized(direction==='forward'?mutation?.canonical:mutation?.publisher),to=normalized(direction==='forward'?mutation?.publisher:mutation?.canonical);
    const replaced=replaceOccurrence(output,from,to,direction==='forward'?0:Number(mutation?.publisher_occurrence)||0);
    if(replaced===null)return null;
    output=replaced;
  }
  return output;
}

function blockDisplayText(block){
  const value=[block?.display_text,block?.text,block?.canonical_text].find(candidate=>text(candidate))??'';
  return text(value)?String(value):'';
}

function sourceBlockRenderOwner(block){
  const role=text(block?.role);
  if(role==='summary')return 'summary';
  if(role==='word_bank')return 'word_bank';
  return 'passage';
}

const INLINE_SOURCE_ROLES=new Set(['english_before','korean_insert','english_after']);

function sourceBlocksDisplayText(blocks){
  return list(blocks).map((block,index)=>{
    const previous=blocks[index-1],inlineWithPrevious=previous&&INLINE_SOURCE_ROLES.has(text(previous?.role))&&INLINE_SOURCE_ROLES.has(text(block?.role));
    return `${index&&!inlineWithPrevious?'\n\n':''}${text(block?.label)?`${text(block.label)} `:''}${blockDisplayText(block)}`;
  }).join('');
}

export function questionRepresentationErrors(value,{canonicalByPassage={}}={}){
  const representation=value&&typeof value==='object'?value:{},errors=[],blocks=list(representation.source_blocks),byId=new Map();
  if(Number(representation.version)!==QUESTION_REPRESENTATION_VERSION)errors.push('question representation version must be 1');
  if(Number(representation.independent_prompt_count)!==1)errors.push('one READY card must contain one independent prompt');
  if(!text(representation.prompt))errors.push('publisher prompt is missing');
  if(!blocks.length)errors.push('source_blocks are missing');
  for(const [index,block] of blocks.entries()){
    const id=text(block?.id),kind=text(block?.kind);
    if(!id||byId.has(id))errors.push(`source block ${index+1} has a duplicate or missing id`);else byId.set(id,block);
    if(!SOURCE_BLOCK_KINDS.includes(kind))errors.push(`source block ${id||index+1} has an unknown kind`);
    if(!blockDisplayText(block))errors.push(`source block ${id||index+1} has no student content`);
    if(kind==='canonical_span'){
      const passageId=text(block?.passage_id),start=Number(block?.start),end=Number(block?.end),canonical=String(block?.canonical_text??''),full=canonicalByPassage[passageId];
      if(!passageId||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start)errors.push(`canonical block ${id||index+1} has an invalid range`);
      if(!canonical)errors.push(`canonical block ${id||index+1} is missing its immutable source text`);
      if(typeof full==='string'&&normalized(full.slice(start,end))!==normalized(canonical))errors.push(`canonical block ${id||index+1} does not equal its passage range`);
      const mutations=list(block?.mutations),display=blockDisplayText(block);
      if(mutations.length){
        if(applyMutations(canonical,mutations)!==normalized(display)||applyMutations(display,mutations,'reverse')!==normalized(canonical))errors.push(`canonical block ${id||index+1} mutations do not round-trip`);
      }else if(normalized(display)!==normalized(canonical))errors.push(`canonical block ${id||index+1} changes source text without local mutations`);
    }
  }
  for(const [index,pointer] of list(representation.pointers).entries()){
    const id=text(pointer?.id),block=byId.get(text(pointer?.block_id)),kind=text(pointer?.kind),confidence=text(pointer?.confidence);
    if(!id)errors.push(`pointer ${index+1} has no id`);
    if(!block)errors.push(`pointer ${id||index+1} references a missing block`);
    if(!POINTER_KINDS.includes(kind))errors.push(`pointer ${id||index+1} has an unknown kind`);
    if(!POINTER_CONFIDENCE.includes(confidence))errors.push(`pointer ${id||index+1} has no confidence`);
    if(confidence==='unresolved'){errors.push(`pointer ${id||index+1} is unresolved`);continue;}
    const start=Number(pointer?.start),end=Number(pointer?.end),display=blockDisplayText(block);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>display.length)errors.push(`pointer ${id||index+1} has an invalid range`);
    if(['blank','point'].includes(kind)&&start!==end)errors.push(`pointer ${id||index+1} must be zero-width`);
    if(kind==='span'){
      if(start===end)errors.push(`span pointer ${id||index+1} is empty`);
      else if(text(pointer?.extracted_text)!==display.slice(start,end))errors.push(`span pointer ${id||index+1} does not equal its extracted text`);
    }
    if(!text(pointer?.evidence))errors.push(`pointer ${id||index+1} has no extraction evidence`);
  }
  const response=representation.response||{},responseType=text(response.type),answer=representation.answer||{};
  if(!RESPONSE_TYPES.includes(responseType))errors.push('response type is unsupported');
  if(['single_choice','multiple_choice'].includes(responseType)){
    const choices=list(response.choices),indexes=list(answer.indexes).map(Number);
    if(choices.length<2||choices.some(choice=>!text(choice)))errors.push('choice response is incomplete');
    if(!indexes.length||indexes.some(index=>!Number.isInteger(index)||index<0||index>=choices.length))errors.push('publisher choice answer is invalid');
    if(responseType==='single_choice'&&indexes.length!==1)errors.push('single choice must have one publisher answer');
    if(responseType==='multiple_choice'&&indexes.length<2)errors.push('multiple choice must have at least two publisher answers');
  }
  if(['written_text','ordering'].includes(responseType)){
    const slots=list(response.slots),gold=list(answer.accepted_answers);
    if(!slots.length||slots.length!==gold.length)errors.push('written response slots do not match publisher answers');
    if(slots.some(slot=>!text(slot?.id)||!text(slot?.label)))errors.push('written response slot is incomplete');
    if(gold.some(values=>!list(values).length||list(values).some(value=>!text(value))))errors.push('written publisher answer is missing');
  }
  if(text(answer.source)!=='publisher_answer_key')errors.push('answer source must be the publisher answer key');
  if(representation.explanation&&text(representation.explanation.source)!=='publisher_explanation')errors.push('explanation source must be the publisher explanation');
  return [...new Set(errors)];
}

export function questionRepresentationPayloadErrors(payload={},options={}){
  const representation=payload?.representation;
  if(!representation)return ['semantic question representation is missing'];
  const errors=questionRepresentationErrors(representation,options);
  if(text(payload.prompt)!==text(representation.prompt))errors.push('runtime prompt differs from the publisher representation');
  const response=representation.response||{},answer=representation.answer||{};
  if(['single_choice','multiple_choice'].includes(response.type)){
    if(JSON.stringify(list(payload.choices))!==JSON.stringify(list(response.choices)))errors.push('runtime choices differ from the publisher representation');
    if(JSON.stringify(list(payload.answer))!==JSON.stringify(list(answer.indexes)))errors.push('runtime answer differs from the publisher answer key');
  }
  if(['written_text','ordering'].includes(response.type)&&JSON.stringify(list(payload.accepted_answers))!==JSON.stringify(list(answer.accepted_answers)))errors.push('runtime written answer differs from the publisher answer key');
  if(text(payload.explanation)!==text(representation?.explanation?.text))errors.push('runtime explanation differs from the publisher explanation');
  const renderedPassage=normalized(list(payload?.spec?.interaction?.passage?.segments).map(segment=>segment?.kind==='blank'?'':segment?.text).join(''));
  for(const block of list(representation.source_blocks).filter(item=>sourceBlockRenderOwner(item)==='summary')){
    if(renderedPassage.includes(normalized(blockDisplayText(block))))errors.push('summary source block is also rendered in the passage');
  }
  const taskText=normalized(payload?.writing_guide?.task_text);
  if(taskText&&list(representation.source_blocks).filter(item=>sourceBlockRenderOwner(item)==='passage').some(block=>normalized(blockDisplayText(block))===taskText))errors.push('writing task repeats a source block already rendered in the passage');
  return [...new Set(errors)];
}

export function publicQuestionRepresentation(value){
  if(!value||typeof value!=='object')return null;
  return {
    version:Number(value.version)||0,
    source_blocks:list(value.source_blocks).map(block=>({id:text(block?.id),kind:text(block?.kind),passageId:text(block?.passage_id)||null,start:Number.isInteger(Number(block?.start))?Number(block.start):null,end:Number.isInteger(Number(block?.end))?Number(block.end):null,displayText:blockDisplayText(block),role:text(block?.role),label:text(block?.label)})),
    prompt:text(value.prompt),
    pointers:list(value.pointers).map(pointer=>({id:text(pointer?.id),label:text(pointer?.label),blockId:text(pointer?.block_id),start:Number.isInteger(Number(pointer?.start))?Number(pointer.start):null,end:Number.isInteger(Number(pointer?.end))?Number(pointer.end):null,kind:text(pointer?.kind),confidence:text(pointer?.confidence)})),
    response:{type:text(value?.response?.type),choices:list(value?.response?.choices),slots:list(value?.response?.slots),constraints:value?.response?.constraints&&typeof value.response.constraints==='object'?value.response.constraints:{}},
  };
}

const lexicalWordCount=value=>(String(value??'').match(/[A-Za-z]+(?:['’][A-Za-z]+)?|[가-힣]+|\d+(?:,\d{3})*(?:\.\d+)?/g)||[]).length;

function passageSegments(representation){
  const pointersByBlock=new Map();
  for(const pointer of list(representation?.pointers)){
    if(text(pointer?.confidence)==='unresolved')continue;
    const blockId=text(pointer?.block_id);
    if(!pointersByBlock.has(blockId))pointersByBlock.set(blockId,[]);
    pointersByBlock.get(blockId).push(pointer);
  }
  const segments=[];
  // Source blocks stay in publisher order. Canonical offsets are provenance only.
  let previousBlock=null;
  for(const block of list(representation?.source_blocks).filter(item=>sourceBlockRenderOwner(item)==='passage')){
    const inlineWithPrevious=previousBlock&&INLINE_SOURCE_ROLES.has(text(previousBlock?.role))&&INLINE_SOURCE_ROLES.has(text(block?.role));
    if(segments.length&&!inlineWithPrevious)segments.push({kind:'text',text:'\n\n'});
    if(text(block?.label))segments.push({kind:'text',text:`${text(block.label)} `});
    const source=blockDisplayText(block),pointers=[...(pointersByBlock.get(text(block?.id))||[])].sort((a,b)=>Number(a.start)-Number(b.start)||Number(a.end)-Number(b.end));
    let cursor=0;
    for(const pointer of pointers){
      const start=Number(pointer.start),end=Number(pointer.end);
      if(start<cursor)continue;
      if(start>cursor)segments.push({kind:'text',text:source.slice(cursor,start)});
      if(pointer.kind==='span')segments.push({kind:'annotation',id:text(pointer.id),label:text(pointer.label),text:source.slice(start,end)});
      else if(pointer.kind==='blank'){
        segments.push({kind:'blank',id:text(pointer.id),label:text(pointer.label),text:''});
        const marker=source.slice(start).match(/^[_＿]{3,}/)?.[0]||'';
        cursor=start+marker.length;
        continue;
      }else segments.push({kind:'position',id:text(pointer.id),label:text(pointer.label),text:''});
      cursor=end;
    }
    if(cursor<source.length)segments.push({kind:'text',text:source.slice(cursor)});
    previousBlock=block;
  }
  return segments.length?segments:[{kind:'text',text:'Source unavailable'}];
}

/** Generic compatibility projection for the current READY renderer.
 * Semantic meaning remains in representation; taxonomy and layout are explicit
 * presentation metadata, never inferred from a publisher, page, or question number.
 */
export function projectQuestionRepresentation(representation,{taxonomy='content_true',layout='',status='available',source={},difficulty=2}={}){
  const response=representation?.response||{},answer=representation?.answer||{},written=['written_text','ordering'].includes(text(response.type));
  const passageBlocks=list(representation?.source_blocks).filter(block=>sourceBlockRenderOwner(block)==='passage');
  const segments=passageSegments(representation),mainText=sourceBlocksDisplayText(passageBlocks);
  const summary=list(representation?.source_blocks).find(block=>text(block?.role)==='summary');
  const wordBank=list(representation?.source_blocks).find(block=>text(block?.role)==='word_bank');
  const constraints=response.constraints&&typeof response.constraints==='object'?response.constraints:{};
  const responseLayout=layout||text(constraints.layout)||(written?(list(response.slots).length>1?'sentence_parts':'sentence'):'');
  const targetPointers=list(representation?.pointers).filter(pointer=>text(pointer?.confidence)!=='unresolved');
  const slots=list(response.slots).map((slot,index)=>{
    const variants=list(answer.accepted_answers?.[index]);
    return {id:text(slot?.id)||`slot-${index+1}`,label:text(slot?.label)||`답 ${index+1}`,control:responseLayout==='sentence'?'textarea':'text',placeholder:'답을 입력하세요',wordCount:lexicalWordCount(variants[0])};
  });
  const renderer=written?'written_input':summary?'summary':passageBlocks.length>1?'structural':targetPointers.length?'annotated_passage_mcq':'standard_mcq';
  const payload={
    publication_version:3,import_status:status==='available'?'ready':'drop',taxonomy,prompt:text(representation?.prompt),set_text:mainText,explanation:text(representation?.explanation?.text),difficulty:Number(difficulty)||2,source,representation,
    family:renderer==='annotated_passage_mcq'?'annotated':renderer==='structural'?'structural':renderer==='summary'?'summary':'standard',
    spec:{version:1,taxonomy,renderer,importStatus:status==='available'?'ready':'drop',passage:{source:'segments',annotations:targetPointers.map(pointer=>({kind:text(pointer.kind),label:text(pointer.label),text:text(pointer.extracted_text)})),deviceMode:targetPointers.some(pointer=>pointer.kind==='blank')?'blank':targetPointers.length?'annotations':'plain'},blocks:[],extras:summary?['summary']:[],choiceMode:written?'none':response.type==='multiple_choice'?'multi':'single',responseMode:written?'input':'choice',gradingMode:written?'accepted_variants':response.type==='multiple_choice'?'exact_set':'exact'},
  };
  payload.variant_segments=segments;
  payload.spec.interaction={version:1,kind:written?'written_response':'choice_list',selection:written?'none':response.type==='multiple_choice'?'multi':'single',passage:{visible:true,segments},choices:{columns:[],rows:written?[]:list(response.choices).map(choice=>({cells:[text(choice)]}))},response:{layout:written?responseLayout:'',slots:written?slots:[],targetIds:written?slots.map((_slot,index)=>text(targetPointers[index]?.id)||slots[index].id):[],template:[]}};
  if(written){
    payload.accepted_answers=list(answer.accepted_answers);payload.response_slots=slots.map(slot=>({id:slot.id,label:slot.label,word_count:slot.wordCount}));
    payload.ai_structure={engine:'codex-cli',contract_version:2};
    const requestedTaskText=text(constraints.task_text),taskTextIsSourceBlock=passageBlocks.some(block=>normalized(blockDisplayText(block))===normalized(requestedTaskText));
    payload.writing_guide={kind:text(constraints.kind)||responseLayout,task_text:taskTextIsSourceBlock?'':requestedTaskText,conditions:list(constraints.conditions),targets:targetPointers.slice(0,slots.length).map(pointer=>({id:text(pointer.id),label:text(pointer.label),text:text(pointer.extracted_text)})),word_bank:list(constraints.word_bank).length?list(constraints.word_bank):wordBank?blockDisplayText(wordBank).split(/\s*\/\s*/):[]};
  }else {payload.choices=list(response.choices);payload.answer=list(answer.indexes);payload.multi_select=response.type==='multiple_choice';}
  if(summary)payload.summary_text=blockDisplayText(summary);
  return payload;
}
