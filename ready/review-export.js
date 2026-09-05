const list=value=>Array.isArray(value)?value:[];
const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

export const REVIEW_ANSWER_MODES=new Set(['included','appendix','excluded']);

export function normalizeReviewExportOptions(data,options={}){
  const available={word:list(data?.words),workbook:list(data?.workbooks)};
  const selectedKinds=list(options.kinds).filter(kind=>available[kind]?.length);
  return {
    answerMode:REVIEW_ANSWER_MODES.has(options.answerMode)?options.answerMode:'appendix',
    kinds:selectedKinds.length?selectedKinds:Object.keys(available).filter(kind=>available[kind].length),
  };
}

function answerValues(value){
  if(value==null)return [];
  if(Array.isArray(value))return value.flatMap(answerValues).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
}

function workbookPrompt(item){
  let prompt=String(item.prompt||'');
  prompt=prompt.replace(/⟦(?:CHOICE|ORDER):(\d+)⟧/g,(_,raw)=>{
    const values=list(item.groups?.[Number(raw)]);
    return values.length?`[ ${values.join(' / ')} ]`:'________';
  });
  return prompt.replace(/_{5,}/g,'________');
}

function answerBlock(label,values){
  const rows=answerValues(values);
  return `<div class="review-export-answer"><strong>${escapeHtml(label)}</strong><span>${rows.length?rows.map(escapeHtml).join('<br>'):'—'}</span></div>`;
}

function wordSection(words){
  if(!words.length)return '';
  return `<section class="review-export-section"><h2>01 · 저장 단어</h2><div class="review-export-word-list">${words.map((item,index)=>{const meanings=list(item.senses).length?item.senses.map(sense=>sense.meaning):[item.meaning],examples=list(item.examples).slice(0,2);return `<article><span>${String(index+1).padStart(2,'0')}</span><div><h3>${escapeHtml(item.lemma||item.word)}</h3><p>${meanings.map(escapeHtml).join(' · ')}</p>${examples.map(example=>`<blockquote><span lang="en">${escapeHtml(example.englishSentence||example.sourceSpan)}</span>${example.publisherTranslation?`<small>${escapeHtml(example.publisherTranslation)}</small>`:''}</blockquote>`).join('')}</div></article>`;}).join('')}</div></section>`;
}

function workbookSection(items,answerMode){
  if(!items.length)return '';
  return `<section class="review-export-section"><h2>02 · 틀린 Workbook</h2>${items.map((item,index)=>`<article class="review-export-item"><header><span>W${index+1}</span><small>${escapeHtml(item.passageTitle)} · ${Number(item.stage)||''}단계 ${escapeHtml(item.number)}</small></header><h3>${escapeHtml(item.title||'Workbook')}</h3><div class="review-export-passage" lang="en">${escapeHtml(workbookPrompt(item))}</div>${answerMode==='included'?`<div class="review-export-inline-answer">${answerBlock('내 답',item.response)}${answerBlock('정답',item.answers)}</div>`:''}</article>`).join('')}</section>`;
}

function appendix(items){
  const workbooks=items.workbooks.map((item,index)=>`<li><strong>W${index+1}</strong><span>${answerValues(item.answers).map(escapeHtml).join('<br>')||'—'}</span></li>`);
  if(!workbooks.length)return '';
  return `<section class="review-export-section review-export-key"><h2>정답</h2><ol>${workbooks.join('')}</ol></section>`;
}

export function reviewExportDocumentHtml(data,options={}){
  const normalized=normalizeReviewExportOptions(data,options),enabled=new Set(normalized.kinds);
  const items={words:enabled.has('word')?list(data?.words):[],workbooks:enabled.has('workbook')?list(data?.workbooks):[]};
  const total=items.words.length+items.workbooks.length;
  return `<article class="review-export-paper"><header class="review-export-cover"><p>READY · REVIEW PRINT</p><h1>${escapeHtml(data?.meta?.title||'복습')}</h1><div><span>${escapeHtml(data?.meta?.school||'')}</span><span>${escapeHtml(data?.meta?.grade||'')}</span><span>${escapeHtml(data?.meta?.studentName||'')}</span></div><small>단어 ${items.words.length} · Workbook ${items.workbooks.length} · 총 ${total}개</small></header>${wordSection(items.words)}${workbookSection(items.workbooks,normalized.answerMode)}${normalized.answerMode==='appendix'?appendix(items):''}</article>`;
}
