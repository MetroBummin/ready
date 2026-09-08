import {extractSentenceRows,inspectFullWorkbookText} from './workbook-factory.mjs';
// Page labels are provenance. Only an explicit passage label creates a boundary.
export function bilingualRows(text) {
  const rows=[];let en='',ko='';
  const flush=()=>{if(en.trim())rows.push({blockType:'SENTENCE',text:en.trim(),translation:ko.trim()});en='';ko='';};
  for(let line of text.split('\n').map(s=>s.trim()).filter(Boolean)){
    if(/^\[?PAGE\s*\d+/i.test(line)||/Name\s*:/.test(line)||/^[가-힣]{2,8}(?:에듀|학원)$/.test(line)||/^\d+$/.test(line))continue;
    line=line.replace(/(?<=[.!?다])\d{4,}$/,'');
    const korean=line.search(/[가-힣]/),inline=korean>0&&/[.!?:]\s*$/.test(line.slice(0,korean));
    if(inline){if(ko)flush();en+=(en?' ':'')+line.slice(0,korean).trim();ko=line.slice(korean);continue;}
    if(korean>=0){ko+=(ko?' ':'')+line;continue;}
    if(ko)flush();en+=(en?' ':'')+line;
  }flush();return rows;
}
export function inspectStudioDocument(text,metadata={}) {
  const pages=[...text.matchAll(/\[PAGE\s+(\d+)\]([\s\S]*?)(?=\[PAGE\s+\d+\]|$)/gi)].map(m=>({page:Number(m[1]),text:m[2]}));
  if(!pages.length)pages.push({page:1,text});
  const groups=new Map();let ambiguous=false,answerLabel='';
  const add=(key,page,body)=>{if(!groups.has(key))groups.set(key,[]);groups.get(key).push({page,text:body});};
  for(const page of pages){
    if(/WORKBOOK\s*정답|Answer\s*Key/i.test(page.text)){
      if(groups.size===1&&groups.has('unlabeled')){add('unlabeled',page.page,page.text);continue;}
      let body='';
      for(const line of page.text.split('\n')){
        const match=line.trim().match(/^(\d{2}(?:~\d{2})?)\s*번(?:\s*\d+\))?\s*$/);
        if(match){if(body.trim()&&answerLabel)add(answerLabel,page.page,'Answer Key\n'+body);answerLabel=match[1];body='';}
        else body+=line+'\n';
      }
      if(body.trim()&&answerLabel)add(answerLabel,page.page,'Answer Key\n'+body);
      continue;
    }
    const header=page.text.slice(0,220)+'\n'+page.text.slice(-220);
    const labels=[...new Set([...header.matchAll(/(\d{2}(?:~\d{2})?)\s*번/g)].map(m=>m[1]))];
    const label=labels.length===1?labels[0]:'';if(labels.length>1)ambiguous=true;
    add(label||'unlabeled',page.page,page.text);
  }
  if(groups.size>1&&groups.has('unlabeled'))ambiguous=true;
  return [...groups].map(([label,parts])=>{
    const sourceText=parts.map(p=>`[PAGE ${p.page}]\n${p.text}`).join('\n'),inspected=inspectFullWorkbookText(sourceText.replace(/WORKBOOK/gi,'워크북')),full=inspected.fullWorkbook;
    const rows=full?inspected.rows:bilingualRows(sourceText);
    // A decoded text layer is not proof of a bilingual sentence boundary.
    // Vertical marginal text / page furniture may otherwise become a "sentence"
    // with a Korean translation and incorrectly arrive pre-confirmed in Studio.
    const invalidSentence=rows.some(r=>!r.translation||!/[A-Za-z]{2,}/.test(r.text)||/^\s*-\s*\d+\s*-/.test(r.text));
    // Unnumbered bilingual text has no publisher sentence/answer-key evidence.
    // Keep its proposed rows editable and require the existing boundary review.
    const reviewRequired=ambiguous||!full||inspected.reviewRequired||rows.length>160||!rows.length||invalidSentence||sourceText.length>1000000;
    return {title:label==='unlabeled'?metadata.title||metadata.documentName: `${metadata.title||'모의고사'} · ${label}번`,number:label==='unlabeled'?'':label,rows,reviewRequired,boundaryConfirmed:!reviewRequired,sourceMetadata:{...metadata,pages:parts.map(p=>p.page)},sourceExercises:full&&sourceText.length<=1000000?inspected.exercises:[],reason:reviewRequired?'지문 경계와 영문·해석을 확인해 주세요.':'지문별 문장쌍을 검토해 주세요.'};
  });
}
export function inspectStudioPaste(text,metadata={}) {
  const extracted=extractSentenceRows(text);if(extracted.pairing!=='tsv_two_column')throw new Error('English<TAB>Korean 2열을 붙여 넣어 주세요.');
  return [{title:metadata.title,rows:extracted.rows.map(r=>({...r,blockType:'SENTENCE'})),boundaryConfirmed:true,sourceMetadata:metadata,sourceExercises:[]}];
}
