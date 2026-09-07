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

export function shuffleWorkbookOrderBatch(batch=[],random=Math.random){
  const shuffled=[...batch];
  for(let index=shuffled.length-1;index>0;index-=1){
    const target=Math.max(0,Math.min(index,Math.floor(random()*(index+1))));
    [shuffled[index],shuffled[target]]=[shuffled[target],shuffled[index]];
  }
  return shuffled;
}

export function progressiveOrderState(group=[],answer='',chosen=[],visibleCount=6,batchOrder=[]){
  const expected=workbookOrderAnswerIndexes(group,answer),limit=Math.max(4,Math.min(6,Number(visibleCount)||6));
  if(!expected.length)return {expected,visible:group.map((_,index)=>index),batch:[],batchIndex:0,nextExpected:-1};
  let matched=0;
  while(matched<chosen.length&&chosen[matched]===expected[matched])matched+=1;
  const lastBatch=Math.max(0,Math.ceil(expected.length/limit)-1),batchIndex=Math.min(lastBatch,Math.floor(matched/limit));
  const batch=expected.slice(batchIndex*limit,(batchIndex+1)*limit),sameBatch=batchOrder.length===batch.length&&batch.every(index=>batchOrder.includes(index));
  return {expected,visible:sameBatch?[...batchOrder]:batch,batch,batchIndex,nextExpected:expected[matched]??-1};
}
