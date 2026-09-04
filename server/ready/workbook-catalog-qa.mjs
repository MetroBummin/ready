const list=value=>Array.isArray(value)?value:[];
const ANSWER_KEY_ARTIFACT=/\s*Answer\s*Key\s*Lesson\s*\d+[\s\S]*?-\s*\d+\s*-\s*/giu;

function cleanAnswerKeyArtifact(value){return String(value??'').replace(ANSWER_KEY_ARTIFACT,' ').replace(/\s+/g,' ').trim();}

export function repairAnswerKeyArtifacts(catalog){
  const copy=structuredClone(catalog),repairs=[];
  for(const stage of list(copy?.stages))for(const item of list(stage.items))for(const field of ['answers','publisherAnswers'])if(Array.isArray(item[field]))item[field]=item[field].map((value,index)=>{const cleaned=cleanAnswerKeyArtifact(value);if(cleaned!==value)repairs.push({stage:stage.stage,itemKey:item.key,field,index});return cleaned;});
  return {catalog:copy,repairs};
}

export function normalizeStageEightChips(catalog){
  const copy=structuredClone(catalog),repairs=[];
  for(const stage of list(copy?.stages)){
    if(Number(stage.stage)!==8)continue;
    for(const item of list(stage.items)){
      if(item.kind!=='reorder_groups'||!Array.isArray(item.groups))continue;
      item.groups=item.groups.map((group,groupIndex)=>list(group).flatMap(chip=>{
        const words=String(chip??'').trim().split(/\s+/u).filter(Boolean);
        if(words.length>1)repairs.push({itemKey:item.key,groupIndex,chip:String(chip),words});
        return words;
      }));
      item.groupTokenCounts=item.groups.map(group=>group.map(()=>1));
    }
  }
  return {catalog:copy,repairs};
}

export function normalizeCatalogText(value){
  return String(value??'').normalize('NFKC').toLowerCase()
    .replace(/[‐‑‒–—−]/g,'-')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\s+/g,' ').trim();
}

function comparableEnglish(value){
  return normalizeCatalogText(value)
    .replace(/\blet s\b/g,'let us').replace(/\bi m\b/g,'i am').replace(/\b(i|you|we|they) ve\b/g,'$1 have')
    .replace(/\b(you|we|they) re\b/g,'$1 are').replace(/\b(he|she|it) s\b/g,'$1 is')
    .replace(/\bthat s\b/g,'that is')
    .replace(/\b(can|could|do|does|did|has|have|had|is|are|was|were|will|would|should|must) n t\b/g,'$1 not')
    .replace(/\s+/g,'');
}

function matchesCanonicalEnglish(value,rows){
  const target=comparableEnglish(value);if(!target)return false;
  for(let start=0;start<rows.length;start+=1){let joined='';for(let end=start;end<rows.length;end+=1){joined+=`${joined?' ':''}${rows[end]?.text||''}`;const candidate=comparableEnglish(joined);if(candidate===target)return true;if(candidate.length>target.length*1.35)break;}}
  return false;
}

function correctionRestoresCanonical(prompt,answers,rows){
  let states=[String(prompt||'')];
  for(let pair=0;pair<answers.length;pair+=2){
    const wrong=String(answers[pair]||''),correct=String(answers[pair+1]||''),next=[];
    if(!wrong||!correct)return false;
    for(const state of states){let at=state.indexOf(wrong);while(at>=0){next.push(`${state.slice(0,at)}${correct}${state.slice(at+wrong.length)}`);at=state.indexOf(wrong,at+1);}}
    states=[...new Set(next)].slice(0,256);if(!states.length)return false;
  }
  return states.some(state=>matchesCanonicalEnglish(state,rows));
}

export function reconstructBlankItem(item={}){
  let slot=0;
  return String(item.prompt||'').replace(/_{5,}/g,()=>String(list(item.answers)[slot++]??''));
}

function contiguousMatches(rows,text,field='text'){
  const target=normalizeCatalogText(text),matches=[];
  if(!target)return matches;
  for(let start=0;start<rows.length;start+=1){
    let joined='';
    for(let end=start;end<rows.length;end+=1){
      joined+=`${joined?' ':''}${rows[end]?.[field]||''}`;
      const normalized=normalizeCatalogText(joined);
      if(normalized===target)matches.push({start,end,rows:rows.slice(start,end+1)});
      if(normalized.length>target.length*1.35)break;
    }
  }
  return matches;
}

function leaksFullAnswer(item){
  const bank=normalizeCatalogText(list(item.wordBank).join(' ')),answers=normalizeCatalogText(list(item.answers).join(' '));
  return !!bank&&!!answers&&bank===answers;
}

function joinedWithoutWhitespace(value){
  return /,(?=[A-Z])/u.test(value)||/(?<!\b[A-Z])[!?](?=[A-Z])/u.test(value)||/(?<!\b[A-Z])\.(?=[A-Z][a-z])/u.test(value);
}

export function auditStageNineItem(item,canonicalRows=[]){
  const reconstructed=reconstructBlankItem(item),englishMatches=contiguousMatches(canonicalRows,reconstructed,'text');
  const sourceMatches=contiguousMatches(canonicalRows,item.source,'translation');
  const actual=normalizeCatalogText(reconstructed);
  const suffixMatches=canonicalRows.filter(row=>actual.endsWith(normalizeCatalogText(row.text)));
  const suffixSpan=suffixMatches.length===1?{start:canonicalRows.indexOf(suffixMatches[0]),end:canonicalRows.indexOf(suffixMatches[0]),rows:suffixMatches}:null;
  const span=englishMatches.length===1?englishMatches[0]:sourceMatches.length===1?sourceMatches[0]:suffixSpan;
  const issues=[];
  if(!span)issues.push('canonical_unmapped');
  else if(normalizeCatalogText(reconstructed)!==normalizeCatalogText(span.rows.map(row=>row.text).join(' '))){
    const expected=normalizeCatalogText(span.rows.map(row=>row.text).join(' '));
    issues.push(actual&&expected&&(actual.includes(expected)||expected.includes(actual))?'partial_answer':'canonical_mismatch');
  }
  if(joinedWithoutWhitespace(reconstructed))issues.push('sentence_joined_without_whitespace');
  if(leaksFullAnswer(item))issues.push('word_bank_leaks_answer');
  return {itemKey:item.key,reconstructed,span,issues:[...new Set(issues)]};
}

export function repairStageNineCatalog(catalog,canonicalRows=[]){
  const copy=structuredClone(catalog),stage=list(copy.stages).find(candidate=>Number(candidate.stage)===9),repairs=[],unresolved=[];
  if(!stage)return {catalog:copy,repairs,unresolved};
  const next=[];
  for(const item of list(stage.items)){
    const audit=auditStageNineItem(item,canonicalRows);
    if(!audit.issues.length){next.push(item);continue;}
    if(!audit.span){unresolved.push(audit);next.push(item);continue;}
    const structural=audit.issues.some(issue=>['partial_answer','canonical_mismatch','sentence_joined_without_whitespace'].includes(issue));
    if(structural){unresolved.push(audit);next.push(item);continue;}
    next.push({...item,wordBank:[],provenance:{...(item.provenance||{}),qaRepair:'stage9_word_bank_removed_v1',qaReason:audit.issues.join(',')}});
    repairs.push({...audit,replacementCount:1});
  }
  stage.items=next.map((item,index)=>({...item,number:index+1}));
  return {catalog:copy,repairs,unresolved};
}

export function auditWorkbookCatalog(catalog,canonicalRows=[]){
  const errors=[],seenKeys=new Set();
  for(const stage of list(catalog?.stages))for(const item of list(stage.items)){
    const answers=list(item.answers);
    if(!item.key||!answers.length)errors.push({stage:stage.stage,itemKey:item.key||'',issue:'missing_key_or_answer'});
    if([...answers,...list(item.publisherAnswers)].some(value=>cleanAnswerKeyArtifact(value)!==String(value??'')))errors.push({stage:stage.stage,itemKey:item.key,issue:'answer_key_page_artifact'});
    if(item.key&&seenKeys.has(item.key))errors.push({stage:stage.stage,itemKey:item.key,issue:'duplicate_item_key'});else seenKeys.add(item.key);
    if(Number(item.stage)!==Number(stage.stage))errors.push({stage:stage.stage,itemKey:item.key,issue:'stage_mismatch'});
    if(item.kind==='blank_input'||item.kind==='verb_form'){
      const blanks=(String(item.prompt||'').match(/_{5,}/g)||[]).length;
      if(blanks!==answers.length)errors.push({stage:stage.stage,itemKey:item.key,issue:'blank_answer_count'});
      if(item.kind==='verb_form'&&list(item.hints).length!==answers.length)errors.push({stage:stage.stage,itemKey:item.key,issue:'hint_answer_count'});
      if(item.kind==='verb_form'&&!matchesCanonicalEnglish(reconstructBlankItem(item),canonicalRows))errors.push({stage:stage.stage,itemKey:item.key,issue:'stage5_canonical_round_trip'});
    }
    if(item.kind==='choice_groups'){
      if((String(item.prompt||'').match(/⟦CHOICE:\d+⟧/g)||[]).length!==answers.length)errors.push({stage:stage.stage,itemKey:item.key,issue:'choice_answer_count'});
      let rebuilt=String(item.prompt||'');answers.forEach((answer,index)=>{rebuilt=rebuilt.replace(`⟦CHOICE:${index}⟧`,answer);});
      if(!matchesCanonicalEnglish(rebuilt,canonicalRows))errors.push({stage:stage.stage,itemKey:item.key,issue:'stage6_canonical_round_trip'});
    }
    if(item.kind==='correction_pairs'){
      if(Number(item.pairCount)*2!==answers.length)errors.push({stage:stage.stage,itemKey:item.key,issue:'correction_pair_count'});
      else if(!correctionRestoresCanonical(item.prompt,answers,canonicalRows))errors.push({stage:stage.stage,itemKey:item.key,issue:'stage7_canonical_round_trip'});
    }
    if(item.kind==='reorder_groups')for(const group of list(item.groups))for(const chip of list(group))if(/\s/u.test(String(chip??'').trim()))errors.push({stage:stage.stage,itemKey:item.key,issue:'stage8_multiword_chip'});
    if(Number(stage.stage)===9)for(const issue of auditStageNineItem(item,canonicalRows).issues)errors.push({stage:9,itemKey:item.key,issue});
  }
  return errors;
}
