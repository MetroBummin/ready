const text=value=>String(value??'').trim();
const list=value=>Array.isArray(value)?value:[];
const normalized=value=>text(value).normalize('NFKC').replace(/[\s\u00a0]+/g,' ');
const countOccurrences=(source,needle)=>needle?source.split(needle).length-1:0;

export const QUESTION_AUTHORING_CONTRACT_VERSION=2;
export const AI_REFERENCE_VARIANT_V2='ai_reference_variant_v2';

function canonicalSpanErrors(span,canonical,label){
  const value=normalized(span),source=normalized(canonical);
  if(!value)return [`${label} is missing`];
  const occurrences=countOccurrences(source,value);
  if(occurrences!==1)return [`${label} must be one exact canonical span (found ${occurrences})`];
  return [];
}

function mutationRoundTripErrors(authoring,payload,canonical){
  const errors=[],canonicalRange=normalized(authoring.canonicalRange),questionRange=normalized(payload.set_text),mutations=list(authoring.mutations);
  errors.push(...canonicalSpanErrors(canonicalRange,canonical,'canonical range'));
  if(!mutations.length)return [...errors,'grammar mutation list is missing'];
  let restored=questionRange;
  for(const [index,mutation] of [...mutations].reverse().entries()){
    const original=normalized(mutation?.canonical),changed=normalized(mutation?.question);
    if(!original||!changed||original===changed){errors.push(`mutation ${mutations.length-index} is incomplete`);continue;}
    if(countOccurrences(restored,changed)!==1){errors.push(`mutation ${mutations.length-index} question form is not unique`);continue;}
    restored=restored.replace(changed,original);
  }
  if(restored!==canonicalRange)errors.push('grammar mutation does not round-trip to the canonical range');
  return errors;
}

function blankRoundTripErrors(authoring,payload,canonical){
  const errors=[],canonicalRange=normalized(authoring.canonicalRange),questionRange=normalized(payload.set_text),mutations=list(authoring.mutations);
  errors.push(...canonicalSpanErrors(canonicalRange,canonical,'canonical range'));
  if(!mutations.length)return [...errors,'blank mutation list is missing'];
  let restored=questionRange;
  for(const mutation of [...mutations].reverse()){
    const original=normalized(mutation?.canonical),changed=normalized(mutation?.question);
    if(!original||!/^[_＿]{3,}$/.test(changed)){errors.push('blank mutation must replace one canonical span with a blank');continue;}
    if(countOccurrences(restored,changed)!==1){errors.push('blank marker is not unique');continue;}
    restored=restored.replace(changed,original);
  }
  if(restored!==canonicalRange)errors.push('blank transformation does not round-trip to the canonical range');
  return errors;
}

function structuralSpanErrors(authoring,payload,canonical){
  const spans=list(authoring.sourceSpans).map(normalized).filter(Boolean),errors=[];
  if(spans.length<2)errors.push('structural question requires at least two source spans');
  for(const [index,span] of spans.entries())errors.push(...canonicalSpanErrors(span,canonical,`structural source span ${index+1}`));
  const rendered=normalized(payload.set_text);
  for(const [index,span] of spans.entries())if(!rendered.includes(span))errors.push(`structural source span ${index+1} was rewritten or omitted`);
  return errors;
}

function answerContractErrors(payload,type,authoring){
  const errors=[],answers=list(payload.answer),choices=list(payload.choices);
  if(type==='multiple_choice'){
    if(!answers.length||answers.some(index=>!Number.isInteger(index)||index<0||index>=choices.length))errors.push('objective answer contract is invalid');
    const verdicts=list(authoring.choiceVerdicts);
    if(verdicts.length!==choices.length)errors.push('choice verdicts must cover every choice');
    else {
      const supported=verdicts.map((value,index)=>value==='correct'?index:null).filter(value=>value!==null);
      if(JSON.stringify(supported)!==JSON.stringify([...answers].sort((a,b)=>a-b)))errors.push('choice verdicts do not prove one answer set');
    }
  }else if(!list(payload.accepted_answers).length)errors.push('written accepted answers are missing');
  return errors;
}

function explanationErrors(payload,authoring,canonical){
  const explanation=text(payload.explanation),anchors=list(authoring.explanationAnchors).map(text).filter(Boolean),errors=[];
  if(explanation.length<45)errors.push('explanation is too generic or short');
  if(/문맥상\s*(?:적절|알맞)|정답이다\.?$/u.test(explanation))errors.push('explanation uses a generic conclusion');
  if(!anchors.length)errors.push('explanation evidence anchors are missing');
  for(const anchor of anchors){
    errors.push(...canonicalSpanErrors(anchor,canonical,'explanation anchor'));
    if(!explanation.includes(anchor))errors.push(`explanation does not cite anchor: ${anchor}`);
  }
  return errors;
}

export function questionAuthoringQualityErrors({payload,type='multiple_choice',canonicalPassage}){
  const authoring=payload?.authoring||{},errors=[];
  if(authoring.method!==AI_REFERENCE_VARIANT_V2)return ['authoring method is not ai_reference_variant_v2'];
  if(Number(authoring.authoringContractVersion)!==QUESTION_AUTHORING_CONTRACT_VERSION)errors.push('authoring contract version must be 2');
  if(!Number.isInteger(Number(authoring.referenceQuestionNo)))errors.push('reference question number is missing');
  if(!['easy','standard','hard'].includes(authoring.variant))errors.push('variant is invalid');
  if(!text(authoring.learningTarget)||!text(authoring.goldAnswerConcept)||!text(authoring.variantPurpose))errors.push('reference learning metadata is incomplete');
  if(payload?.spec?.passage?.source==='authored_variant')errors.push('canonical passage cannot use authored_variant');
  const canonical=normalized(canonicalPassage),transformation=text(authoring.transformation);
  if(!canonical)return ['canonical passage is missing'];
  if(transformation==='none')errors.push(...canonicalSpanErrors(payload.set_text,canonical,'student passage'));
  else if(transformation==='structural_reorder')errors.push(...structuralSpanErrors(authoring,payload,canonical));
  else if(transformation==='grammar_mutation')errors.push(...mutationRoundTripErrors(authoring,payload,canonical));
  else if(transformation==='blank')errors.push(...blankRoundTripErrors(authoring,payload,canonical));
  else errors.push('unsupported passage transformation');
  errors.push(...answerContractErrors(payload,type,authoring),...explanationErrors(payload,authoring,canonical));
  const dimensions=list(authoring.burdenDimensions).map(text).filter(Boolean);
  if(!dimensions.length)errors.push('difficulty burden dimensions are missing');
  if(authoring.variant==='hard'&&dimensions.every(value=>value==='choice_language'))errors.push('hard cannot be only harder wording');
  return [...new Set(errors)];
}

export function questionAuthoringBatchErrors(rows,canonicalPassage){
  const errors=[];
  for(const row of rows)for(const error of questionAuthoringQualityErrors({payload:row.payload,type:row.type,canonicalPassage}))errors.push(`${row.id||'question'}: ${error}`);
  const byReference=new Map();
  for(const row of rows){const no=Number(row.payload?.authoring?.referenceQuestionNo),group=byReference.get(no)||[];group.push(row);byReference.set(no,group);}
  for(const [no,group] of byReference){
    if(group.length>3)errors.push(`Ref ${no}: more than three variants`);
    const variants=new Set(),purposes=new Set(),fingerprints=new Set();
    for(const row of group){
      const authoring=row.payload.authoring,variant=authoring.variant,purpose=normalized(authoring.variantPurpose);
      if(variants.has(variant))errors.push(`Ref ${no}: duplicate ${variant} variant`);variants.add(variant);
      if(purposes.has(purpose))errors.push(`Ref ${no}: duplicate learning value`);purposes.add(purpose);
      const fingerprint=JSON.stringify([normalized(row.payload.prompt),normalized(row.payload.set_text),list(row.payload.choices).map(normalized),list(row.payload.response_slots).length]);
      if(fingerprints.has(fingerprint))errors.push(`Ref ${no}: duplicate question contract`);fingerprints.add(fingerprint);
    }
    const concepts=new Set(group.map(row=>normalized(row.payload.authoring.goldAnswerConcept)));
    const evidence=new Set(group.map(row=>JSON.stringify(list(row.payload.authoring.requiredEvidence).map(normalized))));
    if(concepts.size!==1)errors.push(`Ref ${no}: variants changed the gold answer concept`);
    if(evidence.size!==1)errors.push(`Ref ${no}: variants changed the required evidence`);
  }
  return [...new Set(errors)];
}
