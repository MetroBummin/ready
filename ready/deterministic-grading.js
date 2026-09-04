const list=value=>Array.isArray(value)?value:[];

export function normalizeDeterministicAnswer(value){
  return String(value??'').trim().normalize('NFKC').toLowerCase()
    .replace(/[“”‘’'".,!?;:()[\]{}]/g,'')
    .replace(/\s+/g,' ').trim();
}

function sameIndexes(actual,expected){
  const left=list(actual).map(Number).sort((a,b)=>a-b),right=list(expected).map(Number).sort((a,b)=>a-b);
  return left.length===right.length&&left.every((value,index)=>value===right[index]);
}

export function gradeLocalQuestion(contract={},submission={}){
  if(contract.mode!=='deterministic'&&contract.mode!=='deterministic_then_ai')return {valid:false,needsServer:true};
  if(contract.kind==='choice'){
    const selected=list(submission.selected),valid=selected.length>0&&(contract.selection==='multi'||selected.length===1);
    return {valid,correct:valid&&sameIndexes(selected,contract.answer),answer:list(contract.answer),needsServer:false};
  }
  if(contract.kind==='inline_options'){
    const selected=list(submission.inlineSelected),expected=list(contract.answer),valid=selected.length===expected.length&&selected.every(Number.isInteger);
    return {valid,correct:valid&&selected.every((value,index)=>Number(value)===Number(expected[index])),answer:expected,needsServer:false};
  }
  if(contract.kind==='written'){
    const responses=list(submission.responses).map(value=>String(value??'').trim()),accepted=list(contract.acceptedAnswers),sets=list(contract.acceptedResponseSets);
    if(!responses.length||responses.length!==accepted.length||responses.some(value=>!value))return {valid:false,correct:false,answer:accepted,needsServer:false};
    const correct=sets.length?sets.some(set=>list(set).length===responses.length&&list(set).every((candidate,index)=>normalizeDeterministicAnswer(candidate)===normalizeDeterministicAnswer(responses[index]))):responses.every((value,index)=>(Array.isArray(accepted[index])?accepted[index]:[accepted[index]]).some(candidate=>normalizeDeterministicAnswer(candidate)===normalizeDeterministicAnswer(value)));
    return {valid:true,correct,answer:accepted,needsServer:!correct&&contract.mode==='deterministic_then_ai'};
  }
  return {valid:false,needsServer:true};
}

export function gradeLocalWorkbook(contract={},responses=[],{usedFullAnswerHint=false}={}){
  if(contract.mode!=='deterministic')return {valid:false,needsServer:true};
  const answers=list(contract.answers),values=list(responses);
  if(!answers.length||values.length!==answers.length||values.some(value=>!String(value??'').trim()))return {valid:false,needsServer:false};
  const slotResults=values.map((value,index)=>normalizeDeterministicAnswer(value)===normalizeDeterministicAnswer(answers[index]));
  const completed=slotResults.every(Boolean),correct=completed&&!usedFullAnswerHint;
  return {valid:true,correct,completedAfterHint:completed&&usedFullAnswerHint,answers:correct?[]:answers,slotResults,needsServer:false};
}

export function gradeWorkbookCorrectionPairs(answers=[],responses=[]){
  const expected=list(answers),values=list(responses);
  if(!expected.length||expected.length%2!==0||values.length!==expected.length||values.some(value=>!String(value??'').trim()))return {valid:false,correct:false,slotResults:[]};
  const pairKey=(left,right)=>`${normalizeDeterministicAnswer(left)}\u0000${normalizeDeterministicAnswer(right)}`;
  const remaining=new Map();
  for(let index=0;index<expected.length;index+=2){
    const key=pairKey(expected[index],expected[index+1]);
    remaining.set(key,(remaining.get(key)||0)+1);
  }
  const slotResults=Array(values.length).fill(false);
  for(let index=0;index<values.length;index+=2){
    const key=pairKey(values[index],values[index+1]),count=remaining.get(key)||0;
    if(count>0){slotResults[index]=slotResults[index+1]=true;remaining.set(key,count-1);}
  }
  return {valid:true,correct:slotResults.every(Boolean),slotResults};
}

export function revealLocalWorkbook(contract={},responses=[]){
  if(contract.mode!=='deterministic')return {valid:false,needsServer:true};
  const answers=list(contract.answers),values=list(responses);
  if(!answers.length)return {valid:false,needsServer:false};
  const slotResults=answers.map((answer,index)=>!!String(values[index]??'').trim()&&normalizeDeterministicAnswer(values[index])===normalizeDeterministicAnswer(answer));
  return {valid:true,correct:false,revealedAnswer:true,answers,slotResults,needsServer:false};
}
