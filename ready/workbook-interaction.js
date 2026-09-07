import { normalizeDeterministicAnswer } from './deterministic-grading.js';

const clean=value=>normalizeDeterministicAnswer(value);

export function workbookEnterAction(values=[],currentIndex=0,result=null){
  if(result)return result.correct?{type:'next'}:{type:'retry'};
  const normalized=values.map(value=>String(value??'').trim());
  if(normalized.every(Boolean))return {type:'submit'};
  for(let offset=1;offset<=normalized.length;offset+=1){
    const index=(currentIndex+offset)%normalized.length;
    if(!normalized[index])return {type:'focus',index};
  }
  return {type:'submit'};
}

export function workbookOrderAnswerIndexes(group=[],answer=''){
  const unused=new Set(group.map((_,index)=>index));
  const expected=[];
  for(const token of String(answer??'').trim().split(/\s+/).filter(Boolean)){
    const index=[...unused].find(candidate=>clean(group[candidate])===clean(token));
    if(index===undefined)return [];
    unused.delete(index);
    expected.push(index);
  }
  return expected.length===group.length?expected:[];
}

export function progressiveOrderState(group=[],answer='',chosen=[],visibleCount=5){
  const expected=workbookOrderAnswerIndexes(group,answer),chosenSet=new Set(chosen),remaining=group.map((_,index)=>index).filter(index=>!chosenSet.has(index));
  if(!expected.length)return {expected,visible:remaining,nextExpected:-1};
  const nextExpected=expected[chosen.length]??-1,limit=Math.max(4,Math.min(6,Number(visibleCount)||5));
  if(remaining.length<=limit)return {expected,visible:remaining,nextExpected};
  const visible=remaining.slice(0,limit);
  if(nextExpected>=0&&!visible.includes(nextExpected))visible[visible.length-1]=nextExpected;
  return {expected,visible:visible.sort((left,right)=>left-right),nextExpected};
}
