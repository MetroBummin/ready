import {generatePassageDeterministicCatalog,validateSemanticWorkbookItem,generateWorkbookCatalog} from './workbook-factory.mjs';
import {AUTHORED,sentenceRows,snapshot,syncAnnotations,locateSpan,makeSpan,fieldFor,validateTargets} from '../../ready/admin/studio-contract.js';
const STAGE={korean_blank:1,english_blank:2,verb_form:4,grammar_choice:5};
const publisherFrame=value=>String(value??'').normalize('NFKC').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[‐‑‒–—]/g,'-');
function startsPublisherFrame(text,expected,at){return publisherFrame(text.slice(at,at+expected.length))===publisherFrame(expected);}
function indexPublisherFrame(text,expected,from){
  if(!expected)return from;
  for(let at=from;at<=text.length-expected.length;at++)if(startsPublisherFrame(text,expected,at))return at;
  return -1;
}
export function publisherAnnotationAudit(rows,sourceExercises,metadata={}) {
  const canonical=sentenceRows(rows),annotations=syncAnnotations(rows,{});
  const drops=[];
  if(!sourceExercises?.length)return {annotations,drops};
  const catalog=generateWorkbookCatalog({title:'Publisher candidates',workbookKey:'publisher',rows:canonical,sourceExercises,provenance:metadata});
  for(const stage of catalog.stages.filter(s=>AUTHORED.includes(s.semanticType)))for(const item of stage.items){
    const start=Number(item.canonicalStart)||Number(item.number),end=Number(item.canonicalEnd)||start,spanRows=canonical.slice(start-1,end);
    if(start<1||end<start||spanRows.length!==end-start+1){drops.push({stage:stage.semanticType,number:item.number,canonicalStart:start,canonicalEnd:end,reason:'wrong_canonical_row'});continue;}
    const field=fieldFor(stage.semanticType),segments=[];let text='';
    for(const row of spanRows){if(text)text+=' ';const from=text.length;text+=row[field];segments.push({row,from,to:text.length});}
    const targets=[];let cursor=0,valid=true;
    // Walk the validated frame, so repeated answers cannot select the wrong occurrence.
    const parts=item.prompt.split(/_{5,}|⟦CHOICE:\d+⟧/);
    for(let i=0;i<item.answers.length;i++){
      const answer=item.answers[i],fixed=parts[i]||'',nextFixed=parts[i+1]||'';
      if(startsPublisherFrame(text,fixed,cursor))cursor+=fixed.length;
      else if(stage.stage===4&&fixed.trimEnd()!==fixed&&text.startsWith(fixed.trimEnd()+"'",cursor))cursor+=fixed.trimEnd().length;
      else {drops.push({stage:stage.semanticType,number:item.number,canonicalStart:start,canonicalEnd:end,reason:'prompt_fixed_mismatch',target:i+1});valid=false;break;}
      const exactAnswer=startsPublisherFrame(text,answer,cursor),targetEnd=exactAnswer?cursor+answer.length:nextFixed?indexPublisherFrame(text,nextFixed,cursor):text.length;
      if(targetEnd<cursor){drops.push({stage:stage.semanticType,number:item.number,canonicalStart:start,canonicalEnd:end,reason:'prompt_next_fixed_missing',target:i+1});valid=false;break;}
      const quote=text.slice(cursor,targetEnd);
      if(stage.stage!==4&&publisherFrame(quote)!==publisherFrame(answer)){drops.push({stage:stage.semanticType,number:item.number,canonicalStart:start,canonicalEnd:end,reason:'answer_quote_mismatch',target:i+1});valid=false;break;}
      targets.push({start:cursor,end:targetEnd,quote,...(stage.stage===4?{hint:item.hints[i],answer}:{}),...(stage.stage===5?{correct:quote,distractor:item.groups[i].find(v=>publisherFrame(v)!==publisherFrame(answer))}:{})});cursor=targetEnd;
    }
    const tail=parts.at(-1)||'';
    if(valid&&(!startsPublisherFrame(text,tail,cursor)||cursor+tail.length!==text.length)){drops.push({stage:stage.semanticType,number:item.number,canonicalStart:start,canonicalEnd:end,reason:'prompt_tail_mismatch'});valid=false;}
    if(valid){
      const grouped=new Map();
      for(let i=0;i<targets.length;i++){
        const target=targets[i],segment=segments.find(candidate=>target.start>=candidate.from&&target.end<=candidate.to);
        if(!segment){drops.push({stage:stage.semanticType,number:item.number,canonicalStart:start,canonicalEnd:end,reason:'multi_sentence_target',target:i+1});valid=false;break;}
        try{const converted={...target,span:makeSpan(segment.row[field],target.start-segment.from,target.end-segment.from,segment.row.id)};delete converted.start;delete converted.end;delete converted.quote;const list=grouped.get(segment.row)||[];list.push(converted);grouped.set(segment.row,list);}
        catch(error){drops.push({stage:stage.semanticType,number:item.number,canonicalStart:start,canonicalEnd:end,reason:'makeSpan',target:i+1,message:error.message});valid=false;break;}
      }
      if(valid)for(const [row,rowTargets] of grouped)try{
        const prior=annotations[row.id].steps[stage.semanticType],merged=prior.source==='publisher'?[...prior.targets,...rowTargets]:rowTargets;
        validateTargets(row,stage.semanticType,merged);annotations[row.id].steps[stage.semanticType]={status:'review',source:'publisher',targets:merged,provenance:item.provenance};
      }catch(error){drops.push({stage:stage.semanticType,number:item.number,canonicalStart:start,canonicalEnd:end,reason:'validateTargets',message:error.message});}
    }
  }return {annotations,drops};
}
export function publisherAnnotations(rows,sourceExercises,metadata={}) {return publisherAnnotationAudit(rows,sourceExercises,metadata).annotations;}
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
      targets.forEach((t,index)=>{const p=locateSpan(text,t.span),before=text.slice(cursor,p.start),expandedContraction=stage.stage===4&&/^['’](?:m|re|ve|ll|d)\b/i.test(t.span.quote)&&!/[\s]$/.test(before);prompt+=before+(expandedContraction?' ':'')+(stage.stage===5?`⟦CHOICE:${index}⟧`:'_____');cursor=p.end;});prompt+=text.slice(cursor);
      const old=previousCatalog?.stages?.find(s=>s.stage===stage.stage)?.items?.find(item=>item.provenance?.canonicalSentenceId===row.id||(!item.provenance?.canonicalSentenceId&&item.semanticType===stage.semanticType&&item.number===i+1));
      const item={key:old?.key||`${workbookKey}-s${stage.stage}-${row.id.replace(/[^a-z0-9]/gi,'').slice(-12)}`,stage:stage.stage,number:i+1,semanticType:stage.semanticType,kind:stage.stage===5?'choice_groups':stage.stage===4?'verb_form':'blank_input',source:stage.stage===1?row.text:row.translation,prompt,answers:targets.map(t=>stage.stage===4?t.answer:stage.stage===5?t.correct:t.span.quote),canonicalStart:i+1,canonicalEnd:i+1,provenance:{origin:'confirmed_annotation',canonicalSentenceId:row.id,snapshot:snapshot(row),canonicalRevision:revision}};
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
