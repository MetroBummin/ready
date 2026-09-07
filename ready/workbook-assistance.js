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

export function workbookRecallIsPendingJamo(value,mode){
  if(mode!=='korean_syllable'||workbookRecallCue(value,mode))return false;
  return /[\u1100-\u11ff\u3131-\u318e\ua960-\ua97f\ud7b0-\ud7ff]/u.test(String(value??'').normalize('NFKC'));
}

const HANGUL_INITIALS=['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const HANGUL_MEDIALS=['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const HANGUL_FINALS=['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const HANGUL_BUILD={ㄲ:'ㄱㄱ',ㄸ:'ㄷㄷ',ㅃ:'ㅂㅂ',ㅆ:'ㅅㅅ',ㅉ:'ㅈㅈ',ㅘ:'ㅗㅏ',ㅙ:'ㅗㅐ',ㅚ:'ㅗㅣ',ㅝ:'ㅜㅓ',ㅞ:'ㅜㅔ',ㅟ:'ㅜㅣ',ㅢ:'ㅡㅣ',ㄳ:'ㄱㅅ',ㄵ:'ㄴㅈ',ㄶ:'ㄴㅎ',ㄺ:'ㄹㄱ',ㄻ:'ㄹㅁ',ㄼ:'ㄹㅂ',ㄽ:'ㄹㅅ',ㄾ:'ㄹㅌ',ㄿ:'ㄹㅍ',ㅀ:'ㄹㅎ',ㅄ:'ㅂㅅ'};
const HANGUL_JAMO_TO_COMPAT={...Object.fromEntries(HANGUL_INITIALS.map((value,index)=>[String.fromCodePoint(0x1100+index),value])),...Object.fromEntries(HANGUL_MEDIALS.map((value,index)=>[String.fromCodePoint(0x1161+index),value])),...Object.fromEntries(HANGUL_FINALS.slice(1).map((value,index)=>[String.fromCodePoint(0x11a8+index),value]))};
const hangulBuild=value=>[...(HANGUL_BUILD[value]||value||'')];
function firstHangulUnit(value){
  const text=String(value??'').trim().normalize('NFC'),match=text.match(/[\u1100-\u11ff\u3131-\u318e\ua960-\ua97f\uac00-\ud7ff]/u),character=match?.[0];
  if(!character)return [];
  const code=character.codePointAt(0);
  if(code>=0xac00&&code<=0xd7a3){const offset=code-0xac00,initial=HANGUL_INITIALS[Math.floor(offset/588)],medial=HANGUL_MEDIALS[Math.floor(offset%588/28)],final=HANGUL_FINALS[offset%28];return [...hangulBuild(initial),...hangulBuild(medial),...hangulBuild(final)];}
  const compatibility=HANGUL_JAMO_TO_COMPAT[character]||(code>=0x3131&&code<=0x318e?character:character.normalize('NFKC'));
  return hangulBuild(compatibility);
}

export function koreanRecallCompositionState(value,answer){
  const current=firstHangulUnit(value),expected=firstHangulUnit(answer);
  if(!current.length)return String(value??'').trim()?{state:'mismatch'}:{state:'empty'};
  if(expected.length<2)return {state:'mismatch'};
  const possible=current.length<=expected.length&&current.every((jamo,index)=>jamo===expected[index]);
  if(!possible)return {state:'mismatch'};
  return {state:current.length===expected.length?'exact':'partial'};
}

export function workbookAssistanceMode(item){
  if(item?.semanticType==='korean_blank')return {mode:'recall_unlock',recallMode:'korean_syllable'};
  if(item?.semanticType==='english_blank')return {mode:'recall_unlock',recallMode:'english_initial'};
  if(item?.semanticType==='writing')return {mode:'prefix_typing'};
  if(Number(item?.stage)===2)return {mode:'recall_unlock',recallMode:'korean_syllable'};
  if(Number(item?.stage)===3)return {mode:'recall_unlock',recallMode:'english_initial'};
  if(Number(item?.stage)===9)return {mode:'prefix_typing'};
  return null;
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
