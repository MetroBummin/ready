// Compatibility normalization turns semantic labels such as ⓐ into plain "a".
// Preserve authored display glyphs; use NFKC only in dedicated comparison code.
const compact=value=>String(value||'').normalize('NFC').replace(/\s+/g,' ').trim();
const list=value=>Array.isArray(value)?value:[];
const BLOCK_KINDS=new Set(['passage','prompt','korean_target','condition','word_bank','choice','summary','answer_template','explanation','annotation_source','stimulus']);
const LANGUAGES=new Set(['en','ko','mixed','none']);
const escapeRegExp=value=>String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const PLAIN_TAXONOMIES=new Set(['topic','title','main_idea','purpose','emotion','content_true','content_false','unanswerable']);
const EVIDENCE_TAXONOMIES=new Set(['content_true','content_false','unanswerable']);
const FIXED_ANNOTATION_SPANS=['in order to','as well as','because of','due to','rather than','such as','according to','not only','but also','so that','even though','in case of','in front of','be able to'];
const EVIDENCE_STOPWORDS=new Set('a an and are as at be been being but by did do does for from had has have he her hers him his how i in into is it its may might more most not of on only or our she should so than that the their them they this those to was we were what when where which who why will with would'.split(' '));
const validAnnotationLabel=value=>/^(?:[①-⑧ⓐ-ⓩ]|\([A-H]\)|[㉠-㉭])$/.test(compact(value));
const evidenceTokens=value=>(String(value||'').toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g)||[]).map(token=>token.replace(/[’']/g,"'")).filter(token=>token.length>3&&!EVIDENCE_STOPWORDS.has(token));

export const PIPELINE_CONTRACT_VERSION=2;
export const QUESTION_BLOCK_WHITELISTS=Object.freeze({
  standard_mcq:new Set(['passage','prompt','choice','explanation']),
  annotated_passage_mcq:new Set(['passage','annotation_source','prompt','choice','explanation']),
  structural:new Set(['passage','stimulus','annotation_source','prompt','choice','explanation']),
  summary:new Set(['passage','summary','prompt','choice','answer_template','explanation']),
  written_input:new Set(['passage','prompt','korean_target','condition','word_bank','summary','answer_template','annotation_source','explanation']),
});

export function sourceContractErrors(payload={},spec={}){
  const errors=[],contract=payload.pipeline_contract||{},blocks=list(payload.source_blocks),byId=new Map(),taxonomy=compact(spec?.taxonomy||payload?.taxonomy);
  if(!['exam4you','nernter'].includes(compact(payload?.source?.provider)))errors.push('question source provider is missing or unsupported');
  if(Number(contract.version)!==PIPELINE_CONTRACT_VERSION)errors.push('pipeline contract version is missing');
  if(!/^[a-f0-9]{64}$/i.test(compact(contract.document_sha256)))errors.push('document provenance hash is missing');
  if(!compact(contract.source_question_identity))errors.push('source question identity is missing');
  if(!blocks.length)errors.push('source blocks are missing');
  for(const [index,block] of blocks.entries()){
    const id=compact(block?.id),kind=compact(block?.block_kind),sourceText=compact(block?.source_text),language=compact(block?.language);
    if(!id||byId.has(id))errors.push(`source block ${index+1} has a duplicate or missing id`);else byId.set(id,block);
    if(!BLOCK_KINDS.has(kind))errors.push(`source block ${index+1} has unknown kind ${kind||'?'}`);
    if(!sourceText)errors.push(`source block ${index+1} has no source text`);
    if(!LANGUAGES.has(language))errors.push(`source block ${index+1} has unknown language`);
    if(block?.page!==null&&block?.page!==undefined&&(!Number.isInteger(Number(block.page))||Number(block.page)<1))errors.push(`source block ${index+1} has invalid page`);
    if(block?.bbox!==null&&block?.bbox!==undefined&&(!Array.isArray(block.bbox)||block.bbox.length!==4||block.bbox.some(value=>!Number.isFinite(Number(value)))))errors.push(`source block ${index+1} has invalid bbox`);
  }
  const refs=contract.block_refs&&typeof contract.block_refs==='object'?contract.block_refs:{};
  const used=new Set();
  for(const [role,ids] of Object.entries(refs)){
    if(!BLOCK_KINDS.has(role))errors.push(`unknown block role ${role}`);
    for(const id of list(ids)){
      const block=byId.get(compact(id));
      if(!block)errors.push(`${role} references missing source block ${id}`);
      else if(block.block_kind!==role)errors.push(`${role} references ${block.block_kind} block ${id}`);
      used.add(compact(id));
    }
  }
  const allowed=QUESTION_BLOCK_WHITELISTS[spec?.renderer];
  if(!allowed)errors.push('question family has no block whitelist');
  else for(const id of used){const kind=byId.get(id)?.block_kind;if(kind&&!allowed.has(kind))errors.push(`${spec.renderer} does not allow ${kind} blocks`);}
  for(const required of ['passage','prompt'])if(!list(refs[required]).length)errors.push(`${required} provenance is missing`);
  if(spec?.renderer!=='written_input'&&!list(refs.choice).length)errors.push('choice provenance is missing');
  if(spec?.renderer==='written_input'&&!list(refs.answer_template).length)errors.push('answer template provenance is missing');
  const selectedPassage=list(refs.passage).map(id=>compact(byId.get(compact(id))?.source_text)).filter(Boolean).join(' ');
  const displayedPassage=compact(payload.set_text||payload.variant_text||payload.passage_text);
  if(displayedPassage&&selectedPassage&&displayedPassage!==selectedPassage)errors.push('displayed passage does not equal approved passage blocks');
  const prompt=compact(payload.prompt),sourcePrompt=list(refs.prompt).map(id=>compact(byId.get(compact(id))?.source_text)).filter(Boolean).join(' ');
  if(prompt&&sourcePrompt&&prompt!==sourcePrompt)errors.push('prompt does not equal approved prompt blocks');
  if(/[가-힣]/.test(selectedPassage))errors.push('approved passage contains Korean text');
  if(/밑줄\s*친/.test(prompt)&&spec?.responseMode==='choice'&&!list(spec?.passage?.annotations).length)errors.push('underlined prompt has no geometry-validated annotation spans');
  if(selectedPassage.length>1800)errors.push('approved passage exceeds the student range budget');
  const hasBlankApparatus=/_{3,}/.test(selectedPassage);
  if((hasBlankApparatus&&!taxonomy.startsWith('blank_'))||/(?:^|\s)→/.test(selectedPassage)||/(?:\(\d+\)\s*)?(?:What|Why|How|Where|When|Who|Which)\b[^?]{0,160}\?/i.test(selectedPassage))errors.push('approved passage contains question apparatus');
  if(PLAIN_TAXONOMIES.has(taxonomy)&&(/[ⓐ-ⓩ㉠-㉭]/.test(selectedPassage)||/\([A-H]\)\s*(?:\[[^\]]*\/[^\]]*\]|[_＿]{3,})/.test(selectedPassage)))errors.push('plain question contains inactive passage device');
  const passageIds=new Set(list(refs.passage).map(compact));
  const forbidden=['prompt','korean_target','condition','word_bank','summary','answer_template','explanation'];
  for(const role of forbidden)for(const id of list(refs[role]).map(compact))if(passageIds.has(id))errors.push(`${role} source block leaked into approved passage`);
  if(spec?.responseMode==='choice'){
    const choices=list(payload.choices).map(compact).filter(Boolean),answers=list(payload.answer).map(Number);
    if(choices.length!==5)errors.push(`multiple-choice question requires 5 complete choices, found ${choices.length}`);
    if(answers.length<1||answers.some(value=>!Number.isInteger(value)||value<0||value>=choices.length))errors.push('answer key indexes are invalid');
    if(spec.choiceMode==='single'&&answers.length!==1)errors.push('single-choice answer contract does not match answer key');
    if(spec.choiceMode==='multi'&&answers.length<2)errors.push('multi-choice answer contract does not match answer key');
    if(EVIDENCE_TAXONOMIES.has(taxonomy)){
      const passageVocabulary=new Set(evidenceTokens(selectedPassage));
      choices.forEach((choice,index)=>{const tokens=evidenceTokens(choice);if(tokens.length>=3&&!tokens.some(token=>passageVocabulary.has(token)))errors.push(`choice ${index+1} has no evidence vocabulary in the approved passage range`);});
    }
  }
  for(const [index,annotation] of list(spec?.passage?.annotations).entries()){
    const target=compact(annotation?.text);
    if(!target||!selectedPassage.includes(target))errors.push(`annotation ${index+1} is not an exact continuous passage span`);
    const label=compact(annotation?.label),raw=compact(payload._raw_question_text||selectedPassage);
    if(!validAnnotationLabel(label))errors.push(`annotation ${index+1} has a non-renderable label`);
    if(label&&target){
      const particle='off|on|up|out|in|away|back|over|down|through|around|along';
      const truncated=new RegExp(`${escapeRegExp(label)}\\s*${escapeRegExp(target)}\\s+(${particle})\\b`,'i').exec(raw);
      if(truncated&&!new RegExp(`(?:${particle})$`,'i').test(target))errors.push(`annotation ${index+1} truncates a marked phrasal span`);
      for(const phrase of FIXED_ANNOTATION_SPANS){
        if(target.toLowerCase()===phrase)continue;
        if(!phrase.startsWith(`${target.toLowerCase()} `))continue;
        const incomplete=new RegExp(`${escapeRegExp(label)}\\s*${escapeRegExp(phrase).replace(/\\ /g,'\\s+')}`,'i').test(raw);
        if(incomplete)errors.push(`annotation ${index+1} truncates the fixed expression ${phrase}`);
      }
    }
  }
  if(['grammar_single_error','grammar_multi_error','vocabulary_context','reference'].includes(spec?.taxonomy)&&!list(spec?.passage?.annotations).length)errors.push('annotated question has no validated annotation spans');
  return [...new Set(errors)];
}
