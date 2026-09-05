const list=value=>Array.isArray(value)?value:[];

export function normalizeDeterministicAnswer(value){
  return String(value??'').trim().normalize('NFKC').toLowerCase()
    .replace(/[“”‘’'".,!?;:()[\]{}]/g,'')
    .replace(/\s+/g,' ').trim();
}

export function gradeLocalWorkbook(contract={},responses=[],{usedFullAnswerHint=false}={}){
  if(contract.mode!=='deterministic')return {valid:false,needsServer:true};
  const answers=list(contract.answers),values=list(responses);
  if(!answers.length||values.length!==answers.length||values.some(value=>!String(value??'').trim()))return {valid:false,needsServer:false};
  const slotResults=values.map((value,index)=>normalizeDeterministicAnswer(value)===normalizeDeterministicAnswer(answers[index]));
  const completed=slotResults.every(Boolean),correct=completed&&!usedFullAnswerHint;
  return {valid:true,correct,completedAfterHint:completed&&usedFullAnswerHint,answers:correct?[]:answers,slotResults,needsServer:false};
}

export function gradeWorkbookCorrectionPairs(answers=[],responses=[],{allowIncomplete=false}={}){
  const expected=list(answers),values=list(responses);
  if(!expected.length||expected.length%2!==0||values.length!==expected.length||(!allowIncomplete&&values.some(value=>!String(value??'').trim())))return {valid:false,correct:false,slotResults:[],alignedAnswers:[]};
  const pairKey=(left,right)=>`${normalizeDeterministicAnswer(left)}\u0000${normalizeDeterministicAnswer(right)}`;
  const remaining=new Map(),expectedPairs=[];
  for(let index=0;index<expected.length;index+=2){
    const key=pairKey(expected[index],expected[index+1]);
    expectedPairs.push({key,answers:[expected[index],expected[index+1]],used:false});
    const indexes=remaining.get(key)||[];indexes.push(expectedPairs.length-1);remaining.set(key,indexes);
  }
  const slotResults=Array(values.length).fill(false),matchedPairIndexes=Array(values.length/2).fill(-1);
  for(let index=0;index<values.length;index+=2){
    if(!String(values[index]??'').trim()||!String(values[index+1]??'').trim())continue;
    const key=pairKey(values[index],values[index+1]),indexes=remaining.get(key)||[],matched=indexes.find(pairIndex=>!expectedPairs[pairIndex].used);
    if(matched!==undefined){expectedPairs[matched].used=true;matchedPairIndexes[index/2]=matched;slotResults[index]=slotResults[index+1]=true;}
  }
  const unmatched=expectedPairs.map((pair,index)=>pair.used?-1:index).filter(index=>index>=0),alignedAnswers=[];
  matchedPairIndexes.forEach(pairIndex=>{const resolved=pairIndex>=0?pairIndex:unmatched.shift();alignedAnswers.push(...(expectedPairs[resolved]?.answers||['','']));});
  return {valid:true,correct:slotResults.every(Boolean),slotResults,alignedAnswers};
}

export function revealLocalWorkbook(contract={},responses=[]){
  if(contract.mode!=='deterministic')return {valid:false,needsServer:true};
  const answers=list(contract.answers),values=list(responses);
  if(!answers.length)return {valid:false,needsServer:false};
  const slotResults=answers.map((answer,index)=>!!String(values[index]??'').trim()&&normalizeDeterministicAnswer(values[index])===normalizeDeterministicAnswer(answer));
  return {valid:true,correct:false,revealedAnswer:true,answers,slotResults,needsServer:false};
}
