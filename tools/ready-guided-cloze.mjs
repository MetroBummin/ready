const BLANK=/_{3,}/g;
const lexicalWords=value=>(String(value||'').match(/[A-Za-z0-9]+(?:[,’'\-][A-Za-z0-9]+)*/g)||[]);
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[“”‘’]/g,"'").replace(/[.!?]+\s*$/,'').replace(/\s+/g,' ').trim();
const escapeRegExp=value=>String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const fixedPattern=value=>String(value||'').replace(/[“”‘’]/g,"'").split(/(\s+)/).map(part=>/^\s+$/.test(part)?'\\s+':escapeRegExp(part)).join('');

function frameFromPrompt(prompt){
  const source=String(prompt||''),blankStart=source.search(BLANK);
  if(blankStart<0)return '';
  const bankEnd=source.lastIndexOf('보기',blankStart),start=bankEnd>=0?bankEnd+2:blankStart;
  return source.slice(start).trim().replace(/[.!?]+\s*$/,'');
}

function answerVariants(payload){
  const accepted=Array.isArray(payload?.accepted_answers)?payload.accepted_answers:[];
  if(accepted.length!==1)return [];
  return (Array.isArray(accepted[0])?accepted[0]:[accepted[0]]).map(value=>String(value||'').trim()).filter(Boolean);
}

export function structureGuidedCloze(payload={}){
  const prompt=String(payload.prompt||''),frame=frameFromPrompt(prompt),variants=answerVariants(payload);
  if(!/각\s*빈칸에\s*한\s*단어씩/u.test(prompt)||!frame||!variants.length)return null;
  const parts=frame.split(BLANK),blankCount=parts.length-1;
  if(blankCount<2||!parts.some(part=>lexicalWords(part).length))return null;
  const pattern=new RegExp(`^${parts.map((part,index)=>`${fixedPattern(part)}${index<blankCount?'([^\\s]+)':''}`).join('')}$`,'iu');
  const captures=variants.map(answer=>normalize(answer).match(pattern)?.slice(1)||null);
  if(captures.some(items=>!items||items.length!==blankCount||items.some(item=>lexicalWords(item).length!==1)))return null;
  const acceptedAnswers=Array.from({length:blankCount},(_,index)=>[...new Set(captures.map(items=>items[index]))]);
  const template=[];
  parts.forEach((part,index)=>{
    if(part)template.push({kind:'text',text:part});
    if(index<blankCount)template.push({kind:'slot',slotIndex:index});
  });
  return {
    kind:'sentence_cloze',
    title:'빈칸에 들어갈 단어를 각각 입력하세요.',
    publisherAnswer:variants[0],
    acceptedAnswers,
    responseSlots:acceptedAnswers.map((_answers,index)=>({label:String(index+1),word_count:1})),
    answerTemplate:template,
  };
}

export function applyGuidedClozeContract(payload={}){
  const structured=structureGuidedCloze(payload);
  if(!structured)return false;
  payload.accepted_answers=structured.acceptedAnswers;
  payload.response_slots=structured.responseSlots;
  payload.writing_guide={...(payload.writing_guide||{}),kind:structured.kind,title:structured.title,publisher_answer:structured.publisherAnswer,slot_labels:structured.responseSlots.map(slot=>slot.label),answer_template:structured.answerTemplate};
  return true;
}
