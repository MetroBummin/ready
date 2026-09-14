import {compareCanonicalRows,extractSentenceRows,inspectFullWorkbookText} from './workbook-factory.mjs';
import {verifiedPublisherAnnotations} from './studio-authoring.mjs';
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
    const reviewRequired=ambiguous||(full&&inspected.reviewRequired)||rows.length>160||!rows.length||rows.some(r=>!r.translation)||sourceText.length>1000000;
    return {title:label==='unlabeled'?metadata.title||metadata.documentName: `${metadata.title||'모의고사'} · ${label}번`,number:label==='unlabeled'?'':label,rows,reviewRequired,boundaryConfirmed:!reviewRequired,sourceMetadata:{...metadata,pages:parts.map(p=>p.page)},sourceExercises:full&&sourceText.length<=1000000?inspected.exercises:[],reason:reviewRequired?'지문 경계와 영문·해석을 확인해 주세요.':'지문별 문장쌍을 검토해 주세요.'};
  });
}
export function inspectStudioPaste(text,metadata={}) {
  const extracted=extractSentenceRows(text);if(extracted.pairing!=='tsv_two_column')throw new Error('English<TAB>Korean 2열을 붙여 넣어 주세요.');
  return [{title:metadata.title,rows:extracted.rows.map(r=>({...r,blockType:'SENTENCE'})),boundaryConfirmed:true,sourceMetadata:metadata,sourceExercises:[]}];
}

export function preparePublisherImport(text,canonicalRows=null,metadata={}) {
  const existing=Array.isArray(canonicalRows)&&canonicalRows.length?canonicalRows:null,inspected=inspectFullWorkbookText(text,existing);
  if(!inspected.fullWorkbook)throw Object.assign(new Error('전체 Workbook과 정답표를 찾지 못했습니다.'),{details:{reason:'full_workbook_missing'}});
  if(existing){
    const consistency=compareCanonicalRows(existing,inspected.rows);
    if(!consistency.consistent)throw Object.assign(new Error('기존 canonical 본문·해석과 PDF가 일치하지 않습니다.'),{details:{reason:'canonical_mismatch',consistency}});
  }
  if(inspected.reviewRequired||inspected.incompleteStages?.length)throw Object.assign(new Error('출판사 문제와 정답표의 완전한 연결을 검증하지 못했습니다.'),{details:{reason:inspected.reason,incompleteStages:inspected.incompleteStages||[]}});
  const rows=(existing||inspected.rows.map(row=>({...row,id:crypto.randomUUID(),blockType:'SENTENCE',paragraphIndex:0}))).map(row=>({...row,blockType:row.blockType||row.block_type||'SENTENCE',paragraphIndex:Number(row.paragraphIndex??row.paragraph_index)||0}));
  const annotations=verifiedPublisherAnnotations(rows,inspected.exercises,metadata);
  return {rows,annotations,sourceExercises:inspected.exercises,inspection:{fullWorkbook:true,reviewRequired:false,pairing:inspected.pairing,headings:inspected.headings,incompleteStages:[],sentenceCount:rows.filter(row=>row.blockType==='SENTENCE').length,sourceExerciseCount:inspected.exercises.length}};
}
