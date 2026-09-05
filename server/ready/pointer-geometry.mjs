const text=value=>String(value??'').trim();
const list=value=>Array.isArray(value)?value:[];

function searchable(value){
  const input=String(value??''),chars=[],map=[];
  let spaced=false;
  for(let index=0;index<input.length;index+=1){
    const normalized=input[index].normalize('NFKC').replace(/[’‘]/g,"'").replace(/[“”]/g,'"').toLowerCase();
    for(const raw of normalized){
      if(/\s/.test(raw)){
        if(spaced)continue;
        chars.push(' ');map.push(index);spaced=true;
      }else{
        chars.push(raw);map.push(index);spaced=false;
      }
    }
  }
  while(chars[0]===' '){chars.shift();map.shift();}
  while(chars.at(-1)===' '){chars.pop();map.pop();}
  return {value:chars.join(''),map,input};
}

function exactSpan(source,needle,anchor){
  const haystack=searchable(source),target=searchable(needle);
  if(!target.value)return null;
  const matches=[];
  for(let cursor=haystack.value.indexOf(target.value);cursor>=0;cursor=haystack.value.indexOf(target.value,cursor+1))matches.push(cursor);
  if(!matches.length)return null;
  let start=matches[0];
  if(matches.length>1){
    const anchored=Number(anchor);
    if(!Number.isInteger(anchored))return null;
    const ranked=matches.map(candidate=>({candidate,distance:Math.abs((haystack.map[candidate]??0)-anchored)})).sort((left,right)=>left.distance-right.distance);
    if(ranked[0].distance===ranked[1]?.distance)return null;
    start=ranked[0].candidate;
  }
  const sourceStart=haystack.map[start],sourceEnd=(haystack.map[start+target.value.length-1]??sourceStart)+1;
  return {start:sourceStart,end:sourceEnd,extracted_text:haystack.input.slice(sourceStart,sourceEnd)};
}

export function underlineGroupsForQuestion(geometry,sourceQuestionNo){
  return Object.entries(geometry||{}).flatMap(([key,spans])=>{
    const match=/^(\d+):(\d+)$/.exec(key);
    if(!match||Number(match[2])!==Number(sourceQuestionNo))return [];
    return [{page:Number(match[1]),spans:list(spans)}];
  }).sort((left,right)=>left.page-right.page);
}

function pageUnderlineGroups(geometry){
  return Object.entries(geometry||{}).flatMap(([key,spans])=>{
    const match=/^page:(\d+)$/.exec(key);
    return match?[{page:Number(match[1]),spans:list(spans)}]:[];
  }).sort((left,right)=>left.page-right.page);
}

function contiguousSourceGroups(source,spans,anchor){
  const mapped=spans.map(span=>({span,range:exactSpan(source,span?.text,anchor)})).filter(item=>item.range).sort((left,right)=>Number(left.span?.top)-Number(right.span?.top)||Number(left.span?.x0)-Number(right.span?.x0));
  const groups=[];
  for(const item of mapped){
    const previous=groups.at(-1),tail=previous?.at(-1),lineGap=Number(item.span?.top)-Number(tail?.span?.top),sourceGap=tail?source.slice(tail.range.end,item.range.start):'';
    if(tail&&item.range.start>=tail.range.end&&/^\s*$/.test(sourceGap)&&lineGap>2&&lineGap<=24)previous.push(item);
    else groups.push([item]);
  }
  return groups.map(items=>({start:items[0].range.start,end:items.at(-1).range.end,extracted_text:source.slice(items[0].range.start,items.at(-1).range.end)}));
}

function sourceBlockGeometryPointer(pointer,source,geometry){
  const anchor=Number(pointer?.start),originalStart=Number(pointer?.start),originalEnd=Number(pointer?.end),candidates=[];
  if(!Number.isInteger(anchor))return {status:'none'};
  for(const page of pageUnderlineGroups(geometry)){
    for(const range of contiguousSourceGroups(source,page.spans,anchor)){
      if(range.start>originalStart||range.end<originalEnd||range.start===originalStart&&range.end===originalEnd)continue;
      candidates.push({...range,page:page.page});
    }
  }
  const unique=new Map(candidates.map(candidate=>[`${candidate.start}:${candidate.end}`,candidate]));
  if(unique.size>1)return {status:'ambiguous'};
  if(!unique.size)return {status:'none'};
  const candidate=[...unique.values()][0];
  return {status:'resolved',pointer:{...pointer,start:candidate.start,end:candidate.end,extracted_text:candidate.extracted_text,confidence:'high',evidence:`publisher underline geometry on PDF page ${candidate.page} aligned through the referenced source block`},page:candidate.page};
}

export function applyPublisherUnderlineGeometry(question,geometry){
  const pointers=list(question?.pointers),spanPointers=pointers.filter(pointer=>text(pointer?.kind)==='span');
  if(!/밑줄\s*친/.test(text(question?.prompt))||!spanPointers.length)return {question,mode:'not_applicable'};
  const blocks=new Map(list(question?.source_blocks).map(block=>[text(block?.id),String(block?.text??'')]));
  const groups=underlineGroupsForQuestion(geometry,question?.source_question_no);
  const matching=groups.filter(group=>group.spans.length===spanPointers.length);
  for(const group of matching){
    const resolved=spanPointers.map((pointer,index)=>{
      const source=blocks.get(text(pointer?.block_id)),span=group.spans[index];
      const range=source===undefined?null:exactSpan(source,span?.text,pointer?.start);
      return range?{...pointer,...range,confidence:'high',evidence:`publisher underline geometry on PDF page ${group.page} intersecting exact text glyphs`}:null;
    });
    if(resolved.every(Boolean)){
      let cursor=0;
      const next=pointers.map(pointer=>text(pointer?.kind)==='span'?resolved[cursor++]:pointer);
      return {question:{...question,pointers:next},mode:'geometry',page:group.page};
    }
  }
  if(matching.length){
    const next=pointers.map(pointer=>text(pointer?.kind)==='span'?{...pointer,confidence:'unresolved',evidence:'publisher underline geometry exists but does not map uniquely to the source block'}:pointer);
    return {question:{...question,pointers:next},mode:'unresolved'};
  }
  const sourceResolved=spanPointers.map(pointer=>sourceBlockGeometryPointer(pointer,blocks.get(text(pointer?.block_id))??'',geometry));
  if(sourceResolved.some(item=>item.status==='ambiguous')){
    let cursor=0;
    const next=pointers.map(pointer=>{
      if(text(pointer?.kind)!=='span')return pointer;
      const resolution=sourceResolved[cursor++];
      return resolution.status==='ambiguous'?{...pointer,confidence:'unresolved',evidence:'publisher underline geometry maps ambiguously through the referenced source block'}:resolution.pointer||pointer;
    });
    return {question:{...question,pointers:next},mode:'unresolved'};
  }
  if(sourceResolved.some(item=>item.status==='resolved')){
    let cursor=0;
    const next=pointers.map(pointer=>text(pointer?.kind)==='span'?(sourceResolved[cursor++].pointer||pointer):pointer);
    const pages=[...new Set(sourceResolved.filter(item=>item.status==='resolved').map(item=>item.page))];
    return {question:{...question,pointers:next},mode:'source_block_geometry',page:pages.length===1?pages[0]:null};
  }
  const next=pointers.map(pointer=>text(pointer?.kind)==='span'&&text(pointer?.confidence)==='high'?{...pointer,confidence:'medium',evidence:`${text(pointer?.evidence)}; no deterministic publisher underline geometry match`}:pointer);
  return {question:{...question,pointers:next},mode:'fallback'};
}
