import { normalizeWorkbookOrderAnswer } from './deterministic-grading.js';

// Word-order chip mechanics reused from the former Workbook `word_order`
// stage. A "group" is the list of chips; `answer` is the expected sentence.
// Chips are matched by normalized text, so duplicate words (for example two
// "the" chips) are interchangeable.
const clean=value=>normalizeWorkbookOrderAnswer(value);

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

export function workbookOrderTokenMatches(group=[],expectedIndex=-1,clickedIndex=-1){
  const expected=clean(group[expectedIndex]),clicked=clean(group[clickedIndex]);
  return Boolean(expected)&&expected===clicked;
}

// `practice: true` keeps a wrong chip out of the built sentence and reports
// `practice-wrong`, so the caller decides whether the student continues
// (step 1, tolerated step-2 mistake) or restarts (step 2).
export function workbookOrderClick(group=[],answer='',chosen=[],consumed=[],chipIndex=-1,{practice=false}={}){
  const progressive=progressiveOrderState(group,answer,chosen),nextChosen=[...chosen],nextConsumed=[...consumed];
  if(!Number.isInteger(chipIndex)||chipIndex<0||chipIndex>=group.length||nextConsumed.includes(chipIndex)||progressive.nextExpected<0)return {type:'ignore',chosen:nextChosen,consumed:nextConsumed};
  if(!workbookOrderTokenMatches(group,progressive.nextExpected,chipIndex)){
    if(practice)return {type:'practice-wrong',chosen:nextChosen,consumed:nextConsumed,chipIndex};
    nextConsumed.push(chipIndex);
    nextChosen.push(chipIndex);
    return {type:'wrong',chosen:nextChosen,consumed:nextConsumed};
  }
  nextConsumed.push(chipIndex);
  nextChosen.push(progressive.nextExpected);
  return {type:'correct',chosen:nextChosen,consumed:nextConsumed};
}

export function shuffleWorkbookOrderBatch(batch=[],random=Math.random){
  const shuffled=[...batch];
  for(let index=shuffled.length-1;index>0;index-=1){
    const target=Math.max(0,Math.min(index,Math.floor(random()*(index+1))));
    [shuffled[index],shuffled[target]]=[shuffled[target],shuffled[index]];
  }
  return shuffled;
}

// Expected chip order and the next expected chip. The batch fields come from
// the former Workbook stage, which showed 4-6 chips at a time; sentence
// practice shows every chip (see sentence-practice.js `visibleChips`) and only
// uses `nextExpected` through `workbookOrderClick`.
export function progressiveOrderState(group=[],answer='',chosen=[],visibleCount=6,batchOrder=[]){
  const expected=workbookOrderAnswerIndexes(group,answer),limit=Math.max(4,Math.min(6,Number(visibleCount)||6));
  if(!expected.length)return {expected,visible:group.map((_,index)=>index),batch:[],batchIndex:0,nextExpected:-1};
  let matched=0;
  while(matched<chosen.length&&chosen[matched]===expected[matched])matched+=1;
  const lastBatch=Math.max(0,Math.ceil(expected.length/limit)-1),batchIndex=Math.min(lastBatch,Math.floor(matched/limit));
  const batch=expected.slice(batchIndex*limit,(batchIndex+1)*limit),sameBatch=batchOrder.length===batch.length&&batch.every(index=>batchOrder.includes(index));
  return {expected,visible:sameBatch?[...batchOrder]:batch,batch,batchIndex,nextExpected:expected[matched]??-1};
}
