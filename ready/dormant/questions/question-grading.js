import { normalizeDeterministicAnswer } from '../../deterministic-grading.js';

const list=value=>Array.isArray(value)?value:[];

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
