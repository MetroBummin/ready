const cleanMeaning=value=>String(value??'').replace(/\u0000|[\uD800-\uDFFF]/g,'').trim().slice(0,60);
const key=value=>cleanMeaning(value).toLocaleLowerCase().replace(/\s+/g,' ');

export function googleKoreanDictionaryCandidates(payload,sourceText,{limit=5}={}){
  const sourceKey=key(sourceText),seen=new Set(),meanings=[];
  const add=value=>{const meaning=cleanMeaning(value),normalized=key(meaning);if(!meaning||normalized===sourceKey||seen.has(normalized)||!/[\u3131-\uD79D]/.test(meaning)||meanings.length>=limit)return;seen.add(normalized);meanings.push({id:`dictionary:${normalized}`,meaning,source:'dictionary',gloss:''});};
  const translation=Array.isArray(payload?.[0])?payload[0].map(row=>Array.isArray(row)?row[0]:'').filter(Boolean).join('').trim():'';
  add(translation);
  for(const group of Array.isArray(payload?.[1])?payload[1]:[]){
    for(const term of Array.isArray(group?.[1])?group[1]:[])add(term);
    if(meanings.length>=limit)break;
  }
  return meanings;
}
