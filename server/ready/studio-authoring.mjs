import {generatePassageDeterministicCatalog,validateSemanticWorkbookItem,generateWorkbookCatalog} from './workbook-factory.mjs';
import {AUTHORED,sentenceRows,snapshot,syncAnnotations,locateSpan,makeSpan,fieldFor,validateTargets} from '../../ready/admin/studio-contract.js';
const STAGE={korean_blank:1,english_blank:2,verb_form:4,grammar_choice:5};
export function publisherAnnotations(rows,sourceExercises,metadata={}) {
  const canonical=sentenceRows(rows),annotations=syncAnnotations(rows,{});
  if(!sourceExercises?.length)return annotations;
  const catalog=generateWorkbookCatalog({title:'Publisher candidates',workbookKey:'publisher',rows:canonical,sourceExercises,provenance:metadata});
  for(const stage of catalog.stages.filter(s=>AUTHORED.includes(s.semanticType)))for(const item of stage.items){
    const row=canonical[item.number-1];if(!row||item.canonicalEnd&&item.canonicalStart!==item.canonicalEnd)continue;
    const text=row[fieldFor(stage.semanticType)],targets=[];let cursor=0,valid=true;
    // Walk the validated frame, so repeated answers cannot select the wrong occurrence.
    const parts=item.prompt.split(/_{5,}|⟦CHOICE:\d+⟧/);
    for(let i=0;i<item.answers.length;i++){
      const answer=item.answers[i];cursor+=parts[i]?.length||0;
      if(text.slice(cursor,cursor+answer.length)!==answer){valid=false;break;}
      try{targets.push({span:makeSpan(text,cursor,cursor+answer.length,row.id),...(stage.stage===4?{hint:item.hints[i],answer}:{}),...(stage.stage===5?{correct:answer,distractor:item.groups[i].find(v=>v!==answer)}:{})});}catch{valid=false;break;}cursor+=answer.length;
    }
    if(valid)try{validateTargets(row,stage.semanticType,targets);annotations[row.id].steps[stage.semanticType]={status:'review',source:'publisher',targets,provenance:item.provenance};}catch{}
  }return annotations;
}
export function compileStudio({rows,annotations,title,workbookKey,previousCatalog=null,revision=1,requireConfirmed=false,publishStep=null,provenance={}}) {
  const synced=syncAnnotations(rows,annotations),canonical=sentenceRows(rows),errors=[];
  const catalog=generatePassageDeterministicCatalog({title,workbookKey,rows,previousCatalog,provenance:{...provenance,canonicalRevision:revision,studio:true}});
  for(const stage of catalog.stages.filter(s=>AUTHORED.includes(s.semanticType))){
    if(publishStep&&stage.semanticType!==publishStep){stage.items=structuredClone(previousCatalog?.stages?.find(previous=>previous.semanticType===stage.semanticType)?.items||[]);continue;}
    stage.items=[];for(let i=0;i<canonical.length;i++){
    const row=canonical[i],record=synced[row.id].steps[stage.semanticType];
    if(record.status!=='confirmed'){if(requireConfirmed)errors.push({sentenceId:row.id,number:i+1,step:stage.semanticType,message:'검토 후 확정해 주세요.'});continue;}
    try{
      const targets=validateTargets(row,stage.semanticType,record.targets);if(!targets.length)continue; // explicitly confirmed: no suitable target
      const text=row[fieldFor(stage.semanticType)];let cursor=0,prompt='';
      targets.forEach((t,index)=>{const p=locateSpan(text,t.span);prompt+=text.slice(cursor,p.start)+(stage.stage===5?`⟦CHOICE:${index}⟧`:'_____');cursor=p.end;});prompt+=text.slice(cursor);
      const old=previousCatalog?.stages?.find(s=>s.stage===stage.stage)?.items?.find(item=>item.provenance?.canonicalSentenceId===row.id||(!item.provenance?.canonicalSentenceId&&item.semanticType===stage.semanticType&&item.number===i+1));
      const item={key:old?.key||`${workbookKey}-s${stage.stage}-${row.id.replace(/[^a-z0-9]/gi,'').slice(-12)}`,stage:stage.stage,number:i+1,semanticType:stage.semanticType,kind:stage.stage===5?'choice_groups':stage.stage===4?'verb_form':'blank_input',source:stage.stage===1?row.text:row.translation,prompt,answers:targets.map(t=>t.span.quote),canonicalStart:i+1,canonicalEnd:i+1,provenance:{origin:'confirmed_annotation',canonicalSentenceId:row.id,snapshot:snapshot(row),canonicalRevision:revision}};
      if(stage.stage===4)item.hints=targets.map(t=>t.hint);
      if(stage.stage===5)item.groups=targets.map((t,index)=>index%2?[t.distractor,t.correct]:[t.correct,t.distractor]);
      const error=validateSemanticWorkbookItem(stage.stage,item,new Map(canonical.map((r,n)=>[n+1,r])),canonical);if(error)throw new Error(error);
      stage.items.push(item);
    }catch(error){errors.push({sentenceId:row.id,number:i+1,step:stage.semanticType,message:error.message});}
  }}
  catalog.metrics.stageCoverage=Object.fromEntries(catalog.stages.map(s=>[s.stage,{ready:s.items.length,expected:s.items.length}]));
  catalog.metrics.unresolved=errors.length;catalog.metrics.validatorPass=catalog.stages.reduce((n,s)=>n+s.items.length,0);
  if(errors.length){const error=new Error('문장별 Authoring 검토가 필요합니다.');error.details=errors;throw error;}
  return catalog;
}
