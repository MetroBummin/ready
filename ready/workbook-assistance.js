export function normalizeWorkbookAnswer(value){
  return String(value??'').trim().normalize('NFKC').toLowerCase()
    .replace(/[“”‘’'".,!?;:()[\]{}]/g,'')
    .replace(/\s+/g,' ').trim();
}

export function workbookRecallCue(value,mode){
  const text=String(value??'').trim().normalize('NFKC');
  if(mode==='korean_syllable')return text.match(/[가-힣]/u)?.[0]||'';
  return text.match(/[A-Za-z]/)?.[0]?.toLowerCase()||'';
}

export function workbookSlotCh(value){
  const width=[...String(value??'').normalize('NFKC')].reduce((sum,character)=>sum+(/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uff01-\uff60\uffe0-\uffe6]/u.test(character)?2:character===' '?.65:1),0);
  return Math.min(72,Math.max(4,Math.ceil(width)));
}

export function normalizedPrefixSteps(value){
  const text=String(value??'');
  const steps=[];
  for(let index=1;index<=text.length;index+=1)steps.push(normalizeWorkbookAnswer(text.slice(0,index)));
  return steps;
}

export async function sha256Browser(value,cryptoImpl=globalThis.crypto){
  const bytes=new TextEncoder().encode(String(value));
  const digest=await cryptoImpl.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function verifierMatches(value,verifier){
  if(!verifier?.salt||!verifier?.hash)return false;
  return (await sha256Browser(`${verifier.salt}:${value}`))===verifier.hash;
}

export async function livePrefixState(raw,verifier){
  const normalized=normalizeWorkbookAnswer(raw);
  if(!normalized)return {valid:true,mismatchIndex:-1,complete:false};
  const hashes=Array.isArray(verifier?.prefixHashes)?verifier.prefixHashes:[];
  const complete=normalized.length===Number(verifier?.normalizedLength||0);
  if(normalized.length<=hashes.length&&await verifierMatches(normalized,{salt:verifier.salt,hash:hashes[normalized.length-1]}))return {valid:true,mismatchIndex:-1,complete};
  const steps=normalizedPrefixSteps(raw);
  let lastValidRawIndex=0;
  for(let index=0;index<steps.length;index+=1){
    const prefix=steps[index];
    if(!prefix){lastValidRawIndex=index+1;continue;}
    const expected=hashes[prefix.length-1];
    if(!expected||!await verifierMatches(prefix,{salt:verifier.salt,hash:expected}))break;
    lastValidRawIndex=index+1;
  }
  return {valid:false,mismatchIndex:lastValidRawIndex,complete:false};
}
