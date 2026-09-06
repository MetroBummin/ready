import {selectToken} from './studio-selection.js';
import {AUTHORED,PURE,STEPS,LABELS,fieldFor,makeSpan,locateSpan,dirtyRows,spanTokens,tokenSpan} from './studio-contract.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let api,toast,refresh,openPassage,current=null,step='english_blank',onlyDirty=false,batch=[],localEdits=new Map(),activeSpan=null;
export function initStudio(adapters){({api,toast,refresh,openPassage}=adapters);}
const root=()=>document.querySelector('#studio-authoring');
export async function attachStudio(passageId){
 const result=await api('studio_open',{passageId});if(!result)return;
 current=result;localEdits.clear();activeSpan=null;step='english_blank';onlyDirty=false;
 document.querySelector('#studio-authoring')?.remove();
 if(!document.querySelector('.studio-flow'))document.querySelector('#passage-modal .sheet-head').insertAdjacentHTML('afterend','<nav class="studio-flow"><button class="button quiet" type="button" data-studio-mode="edit">Passage 편집</button><button class="button quiet" type="button" data-studio-mode="authoring">Authoring / Preview</button></nav>');document.querySelector('#passage-editor').insertAdjacentHTML('beforeend','<section id="studio-authoring"></section>');render();root().hidden=true;document.querySelector('#update-passage-form').hidden=false;
}
function status(record){return record?.status==='confirmed'?'✓ 확정':record?.status==='stale'?'⚠ 수정 후 재검토':'● 검토 필요';}
function tokens(row,record){
 const text=row[fieldFor(step)],words=spanTokens(text),targets=record.targets||[];let output='',cursor=0;
 for(let i=0;i<words.length;i++){
  const word=words[i],targetIndex=targets.findIndex(t=>i>=t.span.tokenStart&&i<t.span.tokenEnd),selected=targetIndex>=0,active=selected&&activeSpan?.rowId===row.id&&activeSpan?.step===step&&activeSpan.index===targetIndex;
  output+=esc(text.slice(cursor,word.start));
  output+=`<button type="button" class="studio-word ${selected?'is-target':''} ${active?'is-editing':''}" data-token="${i}" data-row="${row.id}" aria-pressed="${selected}">${esc(word.text)}</button>`;
  cursor=word.end;
 }
 output+=esc(text.slice(cursor));return output;
}
function render(){if(!current||!root())return;const {rows,studio}=current,dirty=new Set(dirtyRows(rows,studio.annotations).map(r=>r.id));
 const visible=rows.filter(r=>r.blockType==='SENTENCE'&&(!onlyDirty||dirty.has(r.id)));
 root().innerHTML=`<div class="studio-head"><div><p class="eyebrow">AUTHORING</p><h2>읽고, 선택하고, 확정하세요.</h2><p>옆 단어를 클릭해 범위를 늘리고, 끝 단어를 다시 클릭해 줄이세요. 테두리는 편집 중인 표현입니다.</p></div><button class="button primary" type="button" data-studio-author>Authoring · ${dirty.size}문장</button></div><div class="studio-chips" role="group" aria-label="Workbook 단계">${STEPS.map(s=>`<button type="button" data-studio-step="${s}" class="${s===step?'active':''}">${LABELS[s]} ${PURE.includes(s)?'AUTO ✓':rows.filter(r=>r.blockType==='SENTENCE').every(r=>studio.annotations[r.id]?.steps[s]?.status==='confirmed')?'✓':'●'}</button>`).join('')}</div><div class="studio-tools"><label><input type="checkbox" data-studio-dirty ${onlyDirty?'checked':''}> 변경·검토할 문장만</label>${AUTHORED.includes(step)?'<button type="button" class="button primary small" data-studio-confirm-all>현재 단계 검수 완료</button>':''}<button type="button" class="button quiet small" data-studio-preview>학생용 Preview</button></div><div id="studio-preview"></div>${PURE.includes(step)?'<p class="empty">Canonical에서 자동 생성됩니다. Preview에서 확인하세요.</p>':visible.map((row,index)=>{const record=studio.annotations[row.id]?.steps[step]||{targets:[]};return `<article class="studio-sentence" data-sentence="${row.id}"><header><span>${index+1} · ${status(record)}${record.source==='publisher'?' · 출판사 원본':''}</span><button type="button" class="button quiet small" data-studio-confirm="${row.id}">${record.targets.length?'이 문장 확정':'출제할 표현 없음 · 확정'}</button></header><p class="studio-prose" lang="${step==='korean_blank'?'ko':'en'}">${tokens(row,record)}</p><p class="studio-translation">${esc(row[fieldFor(step)==='text'?'translation':'text'])}</p><div class="studio-target-controls">${record.targets.map((t,n)=>`<button class="button quiet small" type="button" data-edit-target="${n}" data-row="${row.id}">${esc(t.span.quote)}${['verb_form','grammar_choice'].includes(step)?' · 정답 편집':''}</button>`).join('')}</div><div class="studio-target-editor"></div></article>`;}).join('')}<footer class="studio-footer"><span>${studio.published?'Published':'Draft'} · ${dirty.size?`${dirty.size}문장 검토 필요`:'발행 가능'}</span><button type="button" class="button primary" data-studio-publish ${dirty.size?'disabled':''}>확정 및 발행</button></footer>`;
}
function rowFor(id){return current.rows.find(r=>r.id===id);}
function recordFor(id){return current.studio.annotations[id].steps[step];}
function clickToken(id,index){
 const row=rowFor(id),record=recordFor(id),text=row[fieldFor(step)];
 const currentIndex=activeSpan?.rowId===id&&activeSpan?.step===step?activeSpan.index:null;
 const next=selectToken(record.targets,currentIndex,index);
 next.targets=next.targets.map(target=>{
   const span=tokenSpan(text,target.span.tokenStart,target.span.tokenEnd,id),changed=span.quote!==target.span.quote;
   return {...target,span,...(step==='verb_form'?{hint:target.hint||'',answer:span.quote}:{}),...(step==='grammar_choice'?{correct:span.quote,distractor:changed?'':target.distractor||''}:{})};
 });
 record.targets=next.targets;record.status='review';activeSpan=next.activeIndex===null?null:{rowId:id,step,index:next.activeIndex};
 localEdits.set(`${id}:${step}`,structuredClone(record));render();
}
function editTarget(id,index){const target=recordFor(id).targets[index],element=root().querySelector(`[data-sentence="${id}"] .studio-target-editor`);
 if(!['verb_form','grammar_choice'].includes(step)){activeSpan={rowId:id,step,index};return render();}
 element.innerHTML=`<form data-target-form="${id}" data-index="${index}"><strong>${esc(target.span.quote)}</strong>${step==='verb_form'?`<label>원형 / 힌트<input name="hint" value="${esc(target.hint)}" required></label><label>정답<input name="answer" value="${esc(target.answer)}" required></label>`:`<label>정답<input name="correct" value="${esc(target.correct)}" required></label><label>오답<input name="distractor" value="${esc(target.distractor)}" required></label>`}<button class="button quiet small" type="submit">적용</button></form>`;
 element.querySelector('input')?.focus();
}
async function action(op,extra={}){const result=await api(op,{passageId:current.passage.id,revision:current.passage.canonical_revision,version:current.studio.version,...extra});if(result?.studio){if(op==='studio_confirm_step'){for(const item of extra.confirmations||[{sentenceId:extra.sentenceId}])localEdits.delete(`${item.sentenceId}:${extra.step}`);}current.studio=result.studio;for(const [key,value] of localEdits){const [id,s]=key.split(':');current.studio.annotations[id].steps[s]=value;}render();}return result;}
function previewHtml(item){
 let prompt=esc(item.prompt||'');
 if(item.kind==='choice_groups')prompt=prompt.replace(/⟦CHOICE:(\d+)⟧/g,(_,i)=>`<select>${item.groups[i].map(v=>`<option>${esc(v)}</option>`).join('')}</select>`);
 else if(item.kind==='reorder_groups')prompt=item.groups[0].map(v=>`<button type="button" class="button quiet small">${esc(v)}</button>`).join(' ');
 else if(['translation_input','full_sentence_input'].includes(item.kind))prompt='<textarea rows="3" placeholder="답을 입력하세요"></textarea>';
 else prompt=prompt.replace(/_{5,}/g,'<input class="studio-preview-blank" placeholder="빈칸">');
 return `<article class="card studio-preview-item"><blockquote>${esc(item.source)}</blockquote><div>${prompt}</div>${item.hints?`<p>힌트: ${item.hints.map(esc).join(' · ')}</p>`:''}<details><summary>정답 확인</summary><p>${item.answers.map(esc).join(' / ')}</p></details></article>`;
}
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-studio-mode]');if(!b||!current)return;
 const form=document.querySelector('#update-passage-form');
 if(b.dataset.studioMode==='edit'){form.hidden=false;if(root())root().hidden=true;return;}
 const fields=[...document.querySelectorAll('[data-canonical-en]')],translations=[...document.querySelectorAll('[data-canonical-ko]')],types=[...document.querySelectorAll('[data-canonical-type]')];
 if(fields.length!==current.rows.length||fields.some((e,i)=>e.value!==current.rows[i].text||translations[i].value!==current.rows[i].translation||types[i].value!==current.rows[i].blockType))return toast('Passage 변경을 먼저 저장해 주세요.');
 if(!root())await attachStudio(current.passage.id);
 form.hidden=true;root().hidden=false;
});
document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b||!b.closest('#studio-authoring'))return;
 if(b.dataset.studioStep){step=b.dataset.studioStep;activeSpan=null;return render();}
 if(b.hasAttribute('data-studio-author')){if(localEdits.size)return toast('선택한 표현을 문장별로 확정한 뒤 Authoring을 실행하세요.');const result=await action('studio_author');if(result){onlyDirty=true;render();toast(`${result.dirtySentenceIds.length}문장 후보를 검토해 주세요.`);}return;}
 if(b.dataset.token!==undefined)return clickToken(b.dataset.row,Number(b.dataset.token));
 if(b.dataset.editTarget!==undefined)return editTarget(b.dataset.row,Number(b.dataset.editTarget));
 if(b.hasAttribute('data-studio-confirm-all'))return action('studio_confirm_step',{step,confirmations:current.rows.filter(r=>r.blockType==='SENTENCE').map(row=>({sentenceId:row.id,targets:recordFor(row.id).targets}))});
 if(b.dataset.studioConfirm){const id=b.dataset.studioConfirm;return action('studio_confirm_step',{sentenceId:id,step,targets:recordFor(id).targets});}
 if(b.hasAttribute('data-studio-publish')){if(localEdits.size)return toast('변경한 표현을 먼저 확정해 주세요.');const result=await action('studio_publish');if(result){await refresh();toast('검증한 Workbook을 발행했습니다.');}return;}
 if(b.hasAttribute('data-studio-preview')){const result=await action('studio_preview');if(result){const items=result.catalog.stages.find(s=>s.semanticType===step)?.items||[];document.querySelector('#studio-preview').innerHTML=`<h3>${LABELS[step]} Preview</h3>${items.map(previewHtml).join('')||'<p>이 단계의 문장을 확정하면 Preview가 나타납니다.</p>'}`;}return;}
});
document.addEventListener('change',e=>{if(e.target.hasAttribute('data-studio-dirty')){onlyDirty=e.target.checked;render();}});
document.addEventListener('submit',e=>{const form=e.target;if(!form.hasAttribute('data-target-form'))return;e.preventDefault();const record=recordFor(form.dataset.targetForm);Object.assign(record.targets[Number(form.dataset.index)],Object.fromEntries(new FormData(form)));record.status='review';localEdits.set(`${form.dataset.targetForm}:${step}`,structuredClone(record));render();});
export async function importStudio(form){
 const values=Object.fromEntries(new FormData(form)),files=[...form.elements.pdf.files];delete values.pdf;batch=[];
 const inputs=files.length?files:[null];
 for(const file of inputs){if(file?.size>7000000){toast(`${file.name}: PDF는 7MB 이하로 올려 주세요.`);continue;}
 const pdfBase64=file?await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);}):null;
 const result=await api('studio_import',{...values,sourceKind:file?'pdf':'text',...(file?{pdfBase64,documentName:file.name}:{})});if(result)batch.push(...result.drafts);
 }renderBatch();
}
function renderBatch(){const element=document.querySelector('#factory-review');element.hidden=false;
 element.innerHTML=`<section class="card"><h2>${batch.length}개 Passage Draft</h2><p>지문 경계를 확인하고 필요한 행에서 나누세요. 저장 후 각 Passage에서 편집·Authoring합니다.</p>${batch.map((d,i)=>`<article class="studio-batch"><header><input data-batch-title="${i}" aria-label="Passage 제목" value="${esc(d.job.title)}"><button class="button quiet small" type="button" data-batch-move="${i}:-1" ${i===0?'disabled':''}>↑</button><button class="button quiet small" type="button" data-batch-move="${i}:1" ${i===batch.length-1?'disabled':''}>↓</button><button class="button quiet small" type="button" data-batch-merge="${i}" ${i===batch.length-1?'disabled':''}>다음 지문과 합치기</button></header><small>${esc(d.job.source_metadata?.documentName||'2열 붙여넣기')} · ${d.rows.length}행</small><details><summary>문장·경계 확인</summary>${d.rows.map((r,n)=>`<p>${n?`<button type="button" class="button quiet small" data-batch-split="${i}:${n}">여기서 지문 나누기</button>`:''}<strong>${n+1}</strong> <textarea data-batch-en="${i}:${n}" aria-label="English">${esc(r.text)}</textarea><textarea data-batch-ko="${i}:${n}" aria-label="Korean">${esc(r.translation)}</textarea></p>`).join('')}</details><label><input type="checkbox" data-batch-confirm="${i}" ${d.boundaryConfirmed?'checked':''}> 이 지문의 경계 확인</label><span>${d.saved?'✓ 저장됨':''}</span></article>`).join('')}<button class="button primary" type="button" data-batch-save>모두 Passage로 저장</button></section>`;
}
document.addEventListener('change',e=>{if(e.target.dataset.batchConfirm!==undefined)batch[Number(e.target.dataset.batchConfirm)].boundaryConfirmed=e.target.checked;});
document.addEventListener('input',e=>{for(const [key,field] of [['batchEn','text'],['batchKo','translation']])if(e.target.dataset[key]){const [i,n]=e.target.dataset[key].split(':').map(Number);batch[i].rows[n][field]=e.target.value;}if(e.target.dataset.batchTitle!==undefined)batch[Number(e.target.dataset.batchTitle)].job.title=e.target.value;});
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
 if(b.dataset.batchMove){const [i,delta]=b.dataset.batchMove.split(':').map(Number);[batch[i],batch[i+delta]]=[batch[i+delta],batch[i]];return renderBatch();}
 if(b.dataset.batchSplit){const [i,n]=b.dataset.batchSplit.split(':').map(Number),d=batch[i];if(d.saved)return toast('저장된 Passage는 Studio에서 편집하세요.');const result=await api('studio_split_draft',{jobId:d.job.id,rows:d.rows.slice(n),title:d.job.title+' (2)'});if(result){d.rows=d.rows.slice(0,n);d.boundaryConfirmed=false;batch.splice(i+1,0,{job:result.job,rows:result.job.extracted_rows,boundaryConfirmed:false});renderBatch();}return;}
 if(b.dataset.batchMerge!==undefined){const i=Number(b.dataset.batchMerge),left=batch[i],right=batch[i+1];if(left.saved||right.saved)return toast('저장된 Passage는 합칠 수 없습니다.');if(left.job.source_metadata.documentSha256!==right.job.source_metadata.documentSha256)return toast('서로 다른 PDF는 각 provenance를 유지하도록 별도 Passage로 저장하세요.');const mergedRows=[...left.rows,...right.rows],result=await api('studio_split_draft',{jobId:left.job.id,mergeJobId:right.job.id,rows:mergedRows,title:left.job.title});if(result){batch.splice(i,2,{job:result.job,rows:mergedRows,boundaryConfirmed:false});renderBatch();}return;}
 if(b.hasAttribute('data-batch-save')){if(batch.some(d=>!d.boundaryConfirmed))return toast('각 지문의 경계를 확인해 주세요.');for(const d of batch){if(d.saved)continue;const result=await api('studio_create_draft',{jobId:d.job.id,title:d.job.title,rows:d.rows,boundaryConfirmed:true});if(result)d.saved=result.passageId;else break;}renderBatch();await refresh();const saved=batch.find(d=>d.saved);if(batch.every(d=>d.saved)&&saved){toast(`${batch.length}개 Draft를 저장했습니다.`);await openPassage(saved.saved);}return;}
});
