const compact=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
export const wordCount=value=>(String(value||'').match(/[A-Za-z]+(?:['’][A-Za-z]+)?|\d+(?:,\d{3})*(?:\.\d+)?/g)||[]).length;
const variants=slot=>(Array.isArray(slot)?slot:[slot]).map(value=>compact(String(value||'').replace(/^\s*[ⓐ-ⓩ]\s*/u,'').replace(/^\s*\([A-H]\)\s*/u,''))).filter(Boolean);
export const expectedWordCounts=payload=>(payload?.accepted_answers||[]).map(slot=>{const counts=[...new Set(variants(slot).map(wordCount))];return counts.length===1?counts[0]:null;});
export function applyAnswerKeyWordCounts(payload,spec){
  const counts=expectedWordCounts(payload),slots=Array.isArray(spec?.response_slots)?spec.response_slots:[];
  if(slots.length!==counts.length)return spec;
  spec.response_slots=slots.map((slot,index)=>({...slot,word_count:counts[index]??slot.word_count??null}));
  return spec;
}
const normalized=value=>compact(value).toLowerCase().replace(/[“”‘’]/g,"'");
const includesLoose=(haystack,needle)=>!needle||normalized(haystack).includes(normalized(needle));
const lexical=value=>normalized(value).replace(/[‐‑‒–—―]/g,'-').replace(/[^a-z0-9' -]+/g,' ').replace(/\s+/g,' ').trim();
const includesLexical=(haystack,needle)=>!needle||lexical(haystack).includes(lexical(needle));
const escapeRegExp=value=>String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function restoreCanonicalTargets(spec){
  let restored=String(spec?.passage_text||'');
  for(const target of spec?.targets||[]){
    const shown=String(target?.text||'').trim(),canonical=String(target?.canonical_text||'').trim();
    if(shown&&canonical&&normalized(shown)!==normalized(canonical))restored=restored.replace(new RegExp(escapeRegExp(shown),'gi'),canonical);
  }
  return restored;
}
const withoutAnnotationLabels=value=>String(value||'').replace(/[ⓐ-ⓕ]/g,'').replace(/\([A-H]\)(?=[A-Za-z])/g,'');
const labels=value=>[...new Set(String(value||'').match(/[ⓐ-ⓕ]/g)||[])];
const particleWords=new Set(['off','on','up','out','in','away','back','over','down','through','around','along']);

function markedPhrase(raw,label){
  const index=String(raw||'').indexOf(label);
  if(index<0)return '';
  const tail=String(raw).slice(index+label.length).match(/^\s*([A-Za-z]+(?:['’][A-Za-z]+)?)(?:\s+([A-Za-z]+(?:['’][A-Za-z]+)?))?/);
  if(!tail)return '';
  return tail[2]&&particleWords.has(tail[2].toLowerCase())?`${tail[1]} ${tail[2]}`:tail[1];
}

export function writtenRequirements(question){
  const payload=question?.payload||{},raw=payload._raw_question_text||'',prompt=payload.prompt||'';
  return {
    taskText:/우리말|영작/.test(prompt+raw),
    conditions:/<조건>|조건에 맞/.test(prompt+raw),
    wordBank:/<보기>|주어진 (?:말|단어)(?!\s*수)|제시어/.test(prompt+raw),
    annotations:/고쳐|어색한 (?:부분|곳)|어법상 어색/.test(prompt),
    summary:/요약문|요지문|제목의 빈칸/.test(prompt),
  };
}

export function validateWrittenStructure(question,spec,canonical){
  const payload=question?.payload||{},raw=payload._raw_question_text||'',errors=[],accepted=payload.accepted_answers||[],counts=expectedWordCounts(payload),requirements=writtenRequirements(question);
  if(!raw)errors.push('raw PDF question source missing');
  if(!payload.explanation)errors.push('publisher explanation missing');
  if(normalized(spec.prompt_text)!==normalized(payload.prompt))errors.push('prompt changed during structuring');
  const authoredInRaw=includesLoose(withoutAnnotationLabels(raw),spec.passage_text);
  const authoredRestoresCanonical=includesLexical(canonical,restoreCanonicalTargets(spec));
  if(spec.passage_mode==='authored_variant'&&!authoredInRaw&&!authoredRestoresCanonical)errors.push('student passage cannot be verified as raw text or a canonical annotation overlay');
  if(spec.passage_mode==='canonical_excerpt'&&!includesLoose(canonical,spec.passage_text))errors.push('passage excerpt not found in canonical source');
  if(/[가-힣]|\(\d+\)\s*(?:What|Why|How|Where|When|Who|Which)\b|_{2,}|→/i.test(spec.passage_text))errors.push('student passage contains question apparatus');
  if(spec.summary_text&&includesLoose(spec.passage_text,spec.summary_text))errors.push('summary leaked into student passage');
  if(spec.task_text&&includesLoose(spec.passage_text,spec.task_text))errors.push('Korean target leaked into student passage');
  if(spec.response_slots.length!==accepted.length)errors.push(`answer slot count ${spec.response_slots.length} != ${accepted.length}`);
  accepted.forEach((slot,index)=>{
    const candidates=variants(slot),candidateCounts=candidates.map(wordCount);
    if(!candidates.length||candidateCounts.some(count=>count<1))errors.push(`answer slot ${index+1} has no lexical publisher answer`);
  });
  spec.response_slots.forEach((slot,index)=>{
    if(!Number.isInteger(counts[index])||counts[index]<1)errors.push(`slot ${index+1} publisher word count is invalid`);
    else if(slot.word_count!==counts[index])errors.push(`slot ${index+1} word count ${slot.word_count} != ${counts[index]}`);
  });
  const seenLabels=new Set();
  for(const target of spec.targets||[]){
    if(!target.label||seenLabels.has(target.label))errors.push(`duplicate or missing target label ${target.label||'?'}`);
    seenLabels.add(target.label);
    if(!includesLoose(spec.passage_text,target.text))errors.push(`target is not a continuous student-passage range: ${target.label} ${target.text}`);
    const marked=markedPhrase(raw,target.label);
    if(marked&&particleWords.has(marked.split(/\s+/).at(-1).toLowerCase())&&normalized(target.text)!==normalized(marked))errors.push(`annotation must include the full marked phrase: ${target.label} ${marked}`);
  }
  if(requirements.annotations){for(const label of labels(raw))if(!seenLabels.has(label))errors.push(`required annotation missing: ${label}`);}
  if(requirements.taskText&&!/[가-힣]/.test(spec.task_text))errors.push('required Korean target missing');
  if(requirements.conditions&&!(spec.conditions||[]).length)errors.push('required conditions missing');
  if(requirements.wordBank&&!(spec.word_bank||[]).length)errors.push('required word bank missing');
  if(requirements.summary&&!spec.summary_text)errors.push('required summary missing');
  if((spec.word_bank||[]).some(item=>wordCount(item)>12||/[ⓐ-ⓩ]|\([A-H]\)|_{2,}|→/.test(item)))errors.push('word bank contains question apparatus');
  return [...new Set([...errors,...(spec.issues||[])])];
}
