const WORD_RE=/[A-Za-z]+(?:[’'][A-Za-z]+)*/g;
export const READER_GLOSS_MOTION_MS=160;
export const READER_GLOSS_LOADING_DELAY_MS=250;

export function readerGlossCacheKey({passageId,revision,sentenceId,start,end,sourceText}){
  return ['ready-reader-gloss-v1',passageId,revision||'current',sentenceId,start,end,sourceText].map(value=>encodeURIComponent(String(value??''))).join(':');
}
export function rangesOverlap(left,right){return left.start<right.end&&right.start<left.end;}
export function validReaderGlossResult(result,context){
  const start=Number(result?.start),end=Number(result?.end),text=String(context?.text||''),sourceText=String(result?.sourceText||'');
  return !!result?.resolved&&result.sentenceId===context.sentenceId&&Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>start&&end<=text.length&&text.slice(start,end)===sourceText&&String(result.gloss||'').trim()&&Number(result.confidence)>=0.65;
}
export function readerSentenceTokens(text){
  const tokens=[];for(const match of String(text||'').matchAll(WORD_RE))tokens.push({text:match[0],start:match.index,end:match.index+match[0].length});return tokens;
}
export function readerSentenceMarkup(sentence,replacements=[],pending=[]){
  const text=String(sentence.text||''),occupied=[...replacements].sort((a,b)=>a.start-b.start),pendingByStart=new Map(pending.map(item=>[item.start,item]));let cursor=0,html='';
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  for(const replacement of occupied){
    if(replacement.start<cursor)continue;
    html+=sourceMarkup(text.slice(cursor,replacement.start),sentence,pendingByStart,esc,replacement.start,cursor);
    html+=`<span class="reader-inline-replacement" data-reader-range="${replacement.start}:${replacement.end}"><button type="button" class="reader-inline-gloss" lang="ko" data-reader-gloss-reset="${replacement.start}:${replacement.end}" aria-label="${esc(replacement.gloss)}. ${esc(replacement.sourceText)} 원문으로 되돌리기">${esc(replacement.gloss)}</button><button type="button" class="reader-inline-retry" data-reader-gloss-retry="${replacement.start}:${replacement.end}" aria-label="${esc(replacement.sourceText)} 다른 뜻 다시 찾기">↻</button></span>`;
    cursor=replacement.end;
  }
  html+=sourceMarkup(text.slice(cursor),sentence,pendingByStart,esc,text.length,cursor);
  return html;
}
function sourceMarkup(slice,sentence,pendingByStart,esc,_limit,base=0){
  let cursor=0,html='';for(const token of readerSentenceTokens(slice)){const start=base+token.start,end=base+token.end,pending=pendingByStart.get(start);html+=esc(slice.slice(cursor,token.start));html+=`<button type="button" class="reader-inline-source${pending?.accepted?' is-pending':''}${pending?.loading?' is-loading':''}${pending?.error?' is-error':''}" data-reader-gloss-source data-sentence-id="${esc(sentence.id)}" data-start="${start}" data-end="${end}" aria-busy="${pending?.accepted?'true':'false'}" aria-label="${esc(token.text)} 뜻 보기">${esc(token.text)}</button>`;cursor=token.end;}return html+esc(slice.slice(cursor));
}

const memoryCache=new Map(),pendingRequests=new Map();
function localRead(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function localWrite(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* cache is disposable */}}
function localRemove(key){try{localStorage.removeItem(key);}catch{/* cache is disposable */}}
export function clearReaderGlossMemory(){memoryCache.clear();pendingRequests.clear();}
export function deleteReaderGlossCache(key){if(!key)return;memoryCache.delete(key);pendingRequests.delete(key);localRemove(key);}
export function readReaderGlossCache(key){if(memoryCache.has(key))return memoryCache.get(key);const value=localRead(key);if(value)memoryCache.set(key,value);return value;}
export function resolveReaderGlossCached(key,request){const cached=readReaderGlossCache(key);if(cached)return Promise.resolve(cached);if(pendingRequests.has(key))return pendingRequests.get(key);const pending=Promise.resolve().then(request).then(result=>{if(result?.resolved){memoryCache.set(key,result);localWrite(key,result);}return result;}).finally(()=>pendingRequests.delete(key));pendingRequests.set(key,pending);return pending;}

export function createReaderInlineGloss({root,passage,sentences,request,online=()=>globalThis.navigator?.onLine!==false,reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true}){
  const revision=passage.updated_at||'current',byId=new Map(sentences.map(item=>[item.id,item])),replacements=new Map(),pending=new Map(),intent=new Map();let pointer=null,destroyed=false,sequence=0;
  const sentenceNode=id=>root.querySelector(`[data-reader-sentence-id="${CSS.escape(id)}"]`);
  let noticeTimer;
  function notify(message){const notice=root.querySelector('[data-reader-gloss-notice]'),live=root.querySelector('[data-reader-gloss-live]');if(live)live.textContent=message;if(!notice)return;notice.textContent=message;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice.hidden=true;},2400);}
  function redraw(id,anchor){const node=sentenceNode(id),sentence=byId.get(id);if(!node||!sentence)return;node.innerHTML=readerSentenceMarkup(sentence,replacements.get(id)||[],[...pending.values()].filter(item=>item.sentenceId===id));const target=anchor?.selector?node.querySelector(anchor.selector):null;if(Number.isFinite(anchor?.y)){const after=target?.getBoundingClientRect().top;if(Number.isFinite(after))window.scrollBy(0,after-anchor.y);}if(anchor?.animate&&target){target.classList.remove('reader-inline-dissolve');void target.offsetWidth;target.classList.add('reader-inline-dissolve');if(reducedMotion)target.classList.add('reduced-motion');}}
  function activate(button){
    const sentenceId=button.dataset.sentenceId,start=Number(button.dataset.start),end=Number(button.dataset.end),sentence=byId.get(sentenceId);if(!sentence||destroyed)return;
    const sourceText=sentence.text.slice(start,end),key=readerGlossCacheKey({passageId:passage.id,revision,sentenceId,start,end,sourceText}),intentKey=`${sentenceId}:${start}:${end}`,next=++sequence,anchorY=button.getBoundingClientRect().top;intent.set(intentKey,next);
    if(pending.has(intentKey)){intent.set(intentKey,++sequence);pending.delete(intentKey);redraw(sentenceId);return;}
    const lookupRequest={passageId:passage.id,passageRevision:revision,sentenceId,start,end,sourceText};
    const cached=readReaderGlossCache(key);if(cached){apply(cached,sentenceId,intentKey,next,anchorY,key,lookupRequest);return;}
    if(!online()){notify('오프라인에서는 단어 뜻을 불러올 수 없어요.');return;}
    const status={sentenceId,start,end,accepted:true,loading:false,error:false};pending.set(intentKey,status);redraw(sentenceId);const timer=setTimeout(()=>{if(pending.get(intentKey)===status){status.loading=true;redraw(sentenceId);}},READER_GLOSS_LOADING_DELAY_MS);
    resolveReaderGlossCached(key,()=>request(lookupRequest)).then(result=>{clearTimeout(timer);pending.delete(intentKey);if(destroyed||intent.get(intentKey)!==next||passage.id!==root.dataset.readerPassageId)return;if(validReaderGlossResult(result,{sentenceId,text:sentence.text}))apply(result,sentenceId,intentKey,next,anchorY,key,lookupRequest);else redraw(sentenceId);}).catch(()=>{clearTimeout(timer);pending.delete(intentKey);if(destroyed||intent.get(intentKey)!==next)return;status.error=true;pending.set(intentKey,status);redraw(sentenceId);setTimeout(()=>{if(pending.get(intentKey)===status){pending.delete(intentKey);redraw(sentenceId);}},1200);});
  }
  function apply(result,sentenceId,intentKey,expected,anchorY,cacheKey,lookupRequest){if(destroyed||intent.get(intentKey)!==expected)return;const node=sentenceNode(sentenceId),replacement={...result,cacheKey,lookupRequest},list=(replacements.get(sentenceId)||[]).filter(item=>!rangesOverlap(item,replacement));list.push(replacement);replacements.set(sentenceId,list);redraw(sentenceId,{y:anchorY,selector:`[data-reader-range="${result.start}:${result.end}"]`,animate:true});node?.querySelector(`[data-reader-gloss-reset="${result.start}:${result.end}"]`)?.focus({preventScroll:true});root.querySelector('[data-reader-gloss-live]').textContent=`${result.sourceText}, ${result.gloss}`;}
  function reset(button){const sentenceId=button.closest('[data-reader-sentence-id]')?.dataset.readerSentenceId;if(!sentenceId)return;const [start,end]=button.dataset.readerGlossReset.split(':').map(Number),anchorY=button.closest('[data-reader-range]')?.getBoundingClientRect().top;replacements.set(sentenceId,(replacements.get(sentenceId)||[]).filter(item=>item.start!==start||item.end!==end));redraw(sentenceId,{y:anchorY,selector:`[data-reader-gloss-source][data-start="${start}"]`,animate:true});sentenceNode(sentenceId)?.querySelector(`[data-reader-gloss-source][data-start="${start}"]`)?.focus({preventScroll:true});}
  function retry(button){const sentenceId=button.closest('[data-reader-sentence-id]')?.dataset.readerSentenceId,sentence=byId.get(sentenceId);if(!sentence||destroyed)return;const [start,end]=button.dataset.readerGlossRetry.split(':').map(Number),replacement=(replacements.get(sentenceId)||[]).find(item=>item.start===start&&item.end===end);if(!replacement)return;if(!online()){notify('오프라인에서는 다른 뜻을 다시 찾을 수 없어요.');return;}const lookupRequest=replacement.lookupRequest||{passageId:passage.id,passageRevision:revision,sentenceId,start,end,sourceText:sentence.text.slice(start,end)},key=replacement.cacheKey||readerGlossCacheKey({passageId:passage.id,revision,sentenceId:lookupRequest.sentenceId,start:lookupRequest.start,end:lookupRequest.end,sourceText:lookupRequest.sourceText}),intentKey=`${sentenceId}:${start}:${end}`,next=++sequence,anchorY=button.closest('[data-reader-range]')?.getBoundingClientRect().top;intent.set(intentKey,next);deleteReaderGlossCache(key);button.disabled=true;button.closest('[data-reader-range]')?.classList.add('is-refreshing');resolveReaderGlossCached(key,()=>request({...lookupRequest,retry:true,previousGloss:replacement.gloss})).then(result=>{if(destroyed||intent.get(intentKey)!==next||passage.id!==root.dataset.readerPassageId)return;if(validReaderGlossResult(result,{sentenceId,text:sentence.text}))apply(result,sentenceId,intentKey,next,anchorY,key,lookupRequest);else{redraw(sentenceId);notify('다른 뜻을 찾지 못했어요.');}}).catch(()=>{if(destroyed||intent.get(intentKey)!==next)return;redraw(sentenceId);notify('다른 뜻을 다시 불러오지 못했어요.');});}
  function onPointerDown(event){const button=event.target.closest?.('[data-reader-gloss-source]');if(!button||event.button>0)return;pointer={button,id:event.pointerId,x:event.clientX,y:event.clientY};}
  function onPointerUp(event){if(!pointer||pointer.id!==event.pointerId)return;const current=pointer;pointer=null;if(Math.hypot(event.clientX-current.x,event.clientY-current.y)>8||getSelection()?.toString())return;activate(current.button);}
  function onPointerCancel(){pointer=null;}
  function onClick(event){const retryButton=event.target.closest?.('[data-reader-gloss-retry]');if(retryButton){event.preventDefault();retry(retryButton);return;}const resetButton=event.target.closest?.('[data-reader-gloss-reset]');if(resetButton){event.preventDefault();reset(resetButton);return;}if(event.detail===0){const source=event.target.closest?.('[data-reader-gloss-source]');if(source)activate(source);}}
  root.addEventListener('pointerdown',onPointerDown);root.addEventListener('pointerup',onPointerUp);root.addEventListener('pointercancel',onPointerCancel);root.addEventListener('click',onClick);
  return {destroy(){destroyed=true;clearTimeout(noticeTimer);root.removeEventListener('pointerdown',onPointerDown);root.removeEventListener('pointerup',onPointerUp);root.removeEventListener('pointercancel',onPointerCancel);root.removeEventListener('click',onClick);pending.clear();replacements.clear();}};
}
