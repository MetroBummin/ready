// Shared authoring representation: sentence identity + token range; quote/context validate and rebase edits.
// No provider, database, or student runtime dependency.
export const AUTHORED = ['english_blank','korean_blank','verb_form','grammar_choice'];
export const PURE = ['translation','word_order','writing'];
export const STEPS = [...AUTHORED,...PURE];
export const LABELS = {english_blank:'영어 빈칸',korean_blank:'한글 빈칸',verb_form:'동사형',grammar_choice:'어법 선택',translation:'해석',word_order:'어순',writing:'영작'};
export const sentenceRows = rows => rows.filter(r=>r.active!==false&&(r.blockType||r.block_type||'SENTENCE')==='SENTENCE');
export const snapshot = row => JSON.stringify([row.text,row.translation]);
export const fieldFor = step => step==='korean_blank'?'translation':'text';
export function spanTokens(text) {return [...String(text).matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)].map(m=>({text:m[0],start:m.index,end:m.index+m[0].length}));}
export function tokenSpan(text,tokenStart,tokenEnd,sentenceId='') {
  const tokens=spanTokens(text);
  if(!Number.isInteger(tokenStart)||!Number.isInteger(tokenEnd)||tokenStart<0||tokenEnd<=tokenStart||tokenEnd>tokens.length)throw new Error('선택 범위를 확인해 주세요.');
  const start=tokens[tokenStart].start,end=tokens[tokenEnd-1].end;
  return {sentenceId,tokenStart,tokenEnd,quote:text.slice(start,end),prefix:text.slice(Math.max(0,start-24),start),suffix:text.slice(end,end+24)};
}
export function makeSpan(text,start,end,sentenceId='') {
  const tokens=spanTokens(text),first=tokens.findIndex(t=>t.start<=start&&t.end>start),last=tokens.findIndex(t=>t.start<end&&t.end>=end);
  if(first<0||last<first||start<0||end<=start||end>String(text).length)throw new Error('선택 범위를 확인해 주세요.');
  return {sentenceId,tokenStart:first,tokenEnd:last+1,start,end,quote:text.slice(start,end),prefix:text.slice(Math.max(0,start-24),start),suffix:text.slice(end,end+24)};
}
export function locateSpan(text,span) {
  if(!span?.quote||!Number.isInteger(span.tokenStart)||!Number.isInteger(span.tokenEnd)||span.tokenStart<0||span.tokenEnd<=span.tokenStart)return null;
  if(Number.isInteger(span.start)&&Number.isInteger(span.end)&&span.start>=0&&span.end>span.start&&text.slice(span.start,span.end)===span.quote)return {start:span.start,end:span.end};
  const tokens=spanTokens(text),first=tokens[span.tokenStart],last=tokens[span.tokenEnd-1];
  if(first&&last&&text.slice(first.start,last.end)===span.quote)return {start:first.start,end:last.end};
  return null;
}
function rebaseSpan(text,span,sentenceId){
  const matches=[];let at=-1;
  while((at=text.indexOf(span.quote,at+1))!==-1){const end=at+span.quote.length;if((!span.prefix||text.slice(0,at).endsWith(span.prefix))&&(!span.suffix||text.slice(end).startsWith(span.suffix)))matches.push({start:at,end});}
  if(matches.length!==1){const start=text.indexOf(span.quote);if(start<0||text.indexOf(span.quote,start+1)>=0)return null;matches.splice(0,matches.length,{start,end:start+span.quote.length});}
  try{return makeSpan(text,matches[0].start,matches[0].end,sentenceId);}catch{return null;}
}
export function syncAnnotations(rows,previous={}) {
  const result=structuredClone(previous),active=new Set();
  for(const row of sentenceRows(rows)){
    if(!row.id)throw new Error('문장 ID가 필요합니다.');active.add(row.id);
    const prior=result[row.id],current=snapshot(row);
    if(prior?.snapshot===current&&!prior.retired)continue;
    result[row.id]={snapshot:current,retired:false,steps:Object.fromEntries(AUTHORED.map(step=>[step,{status:prior?'stale':'needed',targets:(prior?.steps?.[step]?.targets||[]).map(t=>({...t,span:rebaseSpan(row[fieldFor(step)],t.span,row.id)})).filter(t=>t.span),source:prior?.steps?.[step]?.source||'manual'}]))};
  }
  for(const id of Object.keys(result))if(!active.has(id))result[id].retired=true;
  return result;
}
export function dirtyRows(rows,annotations) {return sentenceRows(rows).filter(row=>AUTHORED.some(step=>annotations[row.id]?.steps?.[step]?.status!=='confirmed'));}
export function validateTargets(row,step,targets) {
  if(!AUTHORED.includes(step)||!Array.isArray(targets))throw new Error('Authoring step 형식을 확인해 주세요.');
  let last=-1;const text=row[fieldFor(step)],sorted=targets.map(target=>({target,position:locateSpan(text,target.span)})).sort((a,b)=>(a.position?.start??-1)-(b.position?.start??-1));
  for(const {target,position} of sorted){
    if(target.span.sentenceId!==row.id||!position||position.start<last)throw new Error('선택한 표현이 없거나 서로 겹칩니다.');last=position.end;
    if(step==='verb_form'&&(!String(target.hint||'').trim()||!String(target.answer||'').trim()))throw new Error('동사 원형/힌트와 정답을 확인해 주세요.');
    if(step==='grammar_choice'&&(target.correct!==target.span.quote||!String(target.distractor||'').trim()||target.correct.trim().toLowerCase()===target.distractor.trim().toLowerCase()||/[,\n]/.test(target.distractor)))throw new Error('어법 정답과 서로 다른 오답이 필요합니다.');
  }
  return sorted.map(({target})=>target);
}
export function applyCandidates(rows,annotations,candidates,source='ai') {
  const result=syncAnnotations(rows,annotations),byId=new Map(sentenceRows(rows).map(row=>[row.id,row]));
  for(const candidate of candidates||[]){const row=byId.get(candidate.sentenceId);if(!row)continue;
    for(const step of AUTHORED){if(result[row.id].steps[step].status==='confirmed'||result[row.id].steps[step].source==='publisher'&&result[row.id].steps[step].targets.length)continue;
      if(!Array.isArray(candidate[step]))continue;
      let targets;try{targets=candidate[step].map(t=>({...t,span:t.span||(Number.isInteger(t.tokenStart)?tokenSpan(row[fieldFor(step)],t.tokenStart,t.tokenEnd,row.id):makeSpan(row[fieldFor(step)],Number(t.start),Number(t.end),row.id))}));}catch{continue;}
      try{validateTargets(row,step,targets);result[row.id].steps[step]={status:'review',targets,source};}catch{/* Invalid candidate stays dirty; never publish it. */}
    }
  }return result;
}
