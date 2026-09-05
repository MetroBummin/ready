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
  const next=pointers.map(pointer=>text(pointer?.kind)==='span'&&text(pointer?.confidence)==='high'?{...pointer,confidence:'medium',evidence:`${text(pointer?.evidence)}; no deterministic publisher underline geometry match`}:pointer);
  return {question:{...question,pointers:next},mode:'fallback'};
}
