import { livePrefixState, normalizedPrefixSteps, sha256Browser } from './workbook-assistance.js';

const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

export function workbookWritingHtml({value='',disabled=false,visibleAnswer='',liveState=null}={}){
  return `${visibleAnswer?`<p class="workbook-writing-hint" role="status"><strong>5초 힌트</strong><span>${escapeHtml(visibleAnswer)}</span></p>`:''}<label class="workbook-translation workbook-writing${liveState?.valid===false?' live-mismatch':''}"><span>영어 문장 전체</span><textarea rows="4" data-workbook-slot="0" data-workbook-live-prefix="true" enterkeyhint="done" ${disabled?'data-workbook-graded="true" aria-readonly="true"':''} placeholder="영어 문장 전체를 입력하세요" autocapitalize="sentences" spellcheck="false">${escapeHtml(value)}</textarea>${liveState?.valid===false?`<small class="workbook-live-copy"><span>${escapeHtml(value.slice(0,liveState.mismatchIndex))}</span><b>${escapeHtml(value.slice(liveState.mismatchIndex))}</b></small>`:''}</label>`;
}

export function renderWritingPrefixState(input,value,state){
  const wrapper=input?.closest?.('.workbook-writing');if(!wrapper)return;
  wrapper.classList.toggle('live-mismatch',state?.valid===false);
  let copy=wrapper.querySelector('.workbook-live-copy');
  if(state?.valid===false){if(!copy){copy=document.createElement('small');copy.className='workbook-live-copy';wrapper.append(copy);}copy.innerHTML=`<span>${escapeHtml(value.slice(0,state.mismatchIndex))}</span><b>${escapeHtml(value.slice(state.mismatchIndex))}</b>`;}else copy?.remove();
}

export async function previewWritingVerifier(answer,salt='ready-studio-preview'){
  const steps=normalizedPrefixSteps(answer),prefixHashes=[];
  for(const prefix of new Set(steps.filter(Boolean)))prefixHashes[prefix.length-1]=await sha256Browser(`${salt}:${prefix}`);
  return {salt,prefixHashes,normalizedLength:steps.at(-1)?.length||0};
}

export {livePrefixState};
