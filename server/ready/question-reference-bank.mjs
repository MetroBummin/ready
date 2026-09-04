const text=value=>String(value??'').trim();
const list=value=>Array.isArray(value)?value:[];
const normalized=value=>text(value).normalize('NFKC').replace(/[\s\u00a0]+/g,' ');
const occurrences=(source,needle)=>needle?source.split(needle).length-1:0;

export const AI_REFERENCE_BANK='ai_reference_bank';
export const REFERENCE_BANK_CONTRACT_VERSION=1;

function exactSpanErrors(span,canonical,label){
  const value=normalized(span),source=normalized(canonical),count=occurrences(source,value);
  if(!value)return [`${label} is missing`];
  return count===1?[]:[`${label} must be one exact canonical span (found ${count})`];
}

function transformedSourceErrors(payload,authoring,canonical){
  const transformation=text(authoring.transformation||'none');
  if(transformation==='none')return exactSpanErrors(payload.set_text,canonical,'student passage');
  if(transformation==='structural_reorder'){
    const spans=list(authoring.sourceSpans).map(normalized).filter(Boolean),rendered=normalized(payload.set_text),errors=[];
    if(spans.length<2)errors.push('structural question requires at least two canonical spans');
    for(const [index,span] of spans.entries()){
      errors.push(...exactSpanErrors(span,canonical,`structural source span ${index+1}`));
      if(!rendered.includes(span))errors.push(`structural source span ${index+1} was rewritten or omitted`);
    }
    return errors;
  }
  if(!['grammar_mutation','blank'].includes(transformation))return ['unsupported passage transformation'];
  const canonicalRange=normalized(authoring.canonicalRange),mutations=list(authoring.mutations),errors=[];
  errors.push(...exactSpanErrors(canonicalRange,canonical,'canonical range'));
  if(!mutations.length)return [...errors,'mutation list is missing'];
  let restored=normalized(payload.set_text);
  for(const [index,mutation] of [...mutations].reverse().entries()){
    const original=normalized(mutation?.canonical),changed=normalized(mutation?.question);
    if(!original||!changed||original===changed){errors.push(`mutation ${mutations.length-index} is incomplete`);continue;}
    if(transformation==='blank'&&!/^[_＿]{3,}$/.test(changed)){errors.push('blank mutation must use a blank marker');continue;}
    if(occurrences(restored,changed)!==1){errors.push(`mutation ${mutations.length-index} question form is not unique`);continue;}
    restored=restored.replace(changed,original);
  }
  if(restored!==canonicalRange)errors.push(`${transformation} does not round-trip to the canonical range`);
  return errors;
}

function answerErrors(row,authoring){
  const payload=row.payload||{},errors=[];
  if(row.type==='multiple_choice'){
    const choices=list(payload.choices),answers=list(payload.answer),verdicts=list(authoring.choiceVerdicts);
    if(!answers.length||answers.some(index=>!Number.isInteger(index)||index<0||index>=choices.length))errors.push('objective answer contract is invalid');
    if(verdicts.length!==choices.length)errors.push('choice verdicts must cover every choice');
    else {
      const supported=verdicts.map((value,index)=>value==='correct'?index:null).filter(value=>value!==null);
      if(JSON.stringify(supported)!==JSON.stringify([...answers].sort((a,b)=>a-b)))errors.push('choice verdicts do not prove the intended answer set');
    }
  }else if(!list(payload.accepted_answers).length)errors.push('written accepted answers are missing');
  return errors;
}

function explanationErrors(payload,authoring,canonical){
  const explanation=text(payload.explanation),anchors=list(authoring.explanationAnchors).map(text).filter(Boolean),errors=[];
  if(explanation.length<45||/문맥상\s*(?:적절|알맞)|정답이다\.?$/u.test(explanation))errors.push('explanation is generic or too short');
  if(!anchors.length)errors.push('explanation evidence anchors are missing');
  for(const anchor of anchors){
    errors.push(...exactSpanErrors(anchor,canonical,'explanation anchor'));
    if(!explanation.includes(anchor))errors.push(`explanation does not cite anchor: ${anchor}`);
  }
  return errors;
}

export function referenceBankManifestErrors(manifest,{expectedRounds=4,expectedQuestions=80}={}){
  const rows=list(manifest),errors=[],ids=new Set();
  if(rows.length!==expectedQuestions)errors.push(`reference manifest must contain ${expectedQuestions} questions`);
  if(new Set(rows.map(row=>row.round)).size!==expectedRounds)errors.push(`reference manifest must contain ${expectedRounds} rounds`);
  for(const row of rows){
    if(ids.has(row.id))errors.push(`duplicate reference id: ${row.id}`);ids.add(row.id);
    if(row.id!==`r${row.round}-q${row.questionNo}`)errors.push(`invalid reference identity: ${row.id}`);
    if(!text(row.sourcePassage)||!text(row.questionType))errors.push(`${row.id}: source passage or type is missing`);
    if(row.contentReference&&row.overlap==='none')errors.push(`${row.id}: content reference has no canonical overlap`);
    if(!row.answerVerified||!row.explanationAvailable)errors.push(`${row.id}: answer or explanation was not verified`);
  }
  return [...new Set(errors)];
}

export function referenceBankQuestionErrors(row,{canonicalPassage,manifest}){
  const payload=row?.payload||{},authoring=payload.authoring||{},canonical=normalized(canonicalPassage),errors=[];
  if(authoring.method!==AI_REFERENCE_BANK)return ['authoring method is not ai_reference_bank'];
  if(Number(authoring.contractVersion)!==REFERENCE_BANK_CONTRACT_VERSION)errors.push('reference bank contract version must be 1');
  if(!text(authoring.referenceBank))errors.push('reference bank id is missing');
  if(Number(authoring.independentPromptCount)!==1)errors.push('one READY card must contain one independently answerable question');
  if(!text(authoring.learningTarget)||!text(authoring.answerConcept))errors.push('learning target or answer concept is missing');
  if(![1,2,3].includes(Number(row.difficulty))||Number(authoring.difficulty)!==Number(row.difficulty))errors.push('difficulty contract is invalid');
  if(payload?.spec?.passage?.source==='authored_variant')errors.push('canonical passage cannot use authored_variant');
  if(!canonical)return ['canonical passage is missing'];

  const referenceMap=new Map(list(manifest).map(ref=>[ref.id,ref])),supporting=list(authoring.supportingReferences);
  if(!supporting.length)errors.push('supporting content references are missing');
  for(const id of supporting){
    const reference=referenceMap.get(id);
    if(!reference)errors.push(`unknown supporting reference: ${id}`);
    else if(!reference.contentReference)errors.push(`non-overlap reference cannot provide content truth: ${id}`);
  }

  for(const evidence of list(authoring.requiredEvidence))errors.push(...exactSpanErrors(evidence,canonical,'required evidence'));
  errors.push(...transformedSourceErrors(payload,authoring,canonical));
  errors.push(...answerErrors(row,authoring));
  errors.push(...explanationErrors(payload,authoring,canonical));

  const dimensions=list(authoring.burdenDimensions).map(text).filter(Boolean);
  if(!dimensions.length)errors.push('difficulty burden dimensions are missing');
  if(Number(row.difficulty)===3&&dimensions.every(value=>value==='choice_language'))errors.push('Hard cannot be only harder wording');
  return [...new Set(errors)];
}

export function referenceBankBatchErrors(rows,options){
  const errors=[];
  for(const row of list(rows))for(const error of referenceBankQuestionErrors(row,options))errors.push(`${row.id||'question'}: ${error}`);
  const purposes=new Set(),fingerprints=new Set();
  for(const row of list(rows)){
    const authoring=row.payload?.authoring||{},purpose=normalized(`${authoring.learningTarget}|${authoring.answerConcept}`);
    if(purposes.has(purpose))errors.push(`${row.id}: duplicate learning target and answer concept`);purposes.add(purpose);
    const fingerprint=JSON.stringify([normalized(row.payload?.prompt),normalized(row.payload?.set_text),list(row.payload?.choices).map(normalized),list(row.payload?.response_slots).length]);
    if(fingerprints.has(fingerprint))errors.push(`${row.id}: duplicate question contract`);fingerprints.add(fingerprint);
  }
  return [...new Set(errors)];
}
