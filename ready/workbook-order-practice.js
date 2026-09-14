function number(value){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:0;
}

export function workbookSemanticType(stage={},item={}){
  const semanticType=String(item?.semanticType||stage?.semanticType||'').trim();
  if(semanticType)return semanticType;
  // Older catalogs did not annotate the stage, but the rendered task type is
  // still the semantic word-order contract rather than a numbered stage.
  return item?.kind==='reorder_groups'?'word_order':'';
}

export function workbookOrderModeAtProblemStart(stage={},item={}){
  if(workbookSemanticType(stage,item)!=='word_order')return null;
  // The server keeps completed cycles when a catalog changes. Prefer that
  // durable round boundary over a recalculated percentage or item count.
  const cycleValue=stage?.completedCycles,hasCompletedCycles=cycleValue!==null&&cycleValue!==undefined&&String(cycleValue).trim()!==''&&Number.isFinite(Number(cycleValue));
  if(hasCompletedCycles)return number(cycleValue)>=2?'real':'practice';
  const total=number(stage?.total),correctClears=number(stage?.correctClears),progressPercent=number(stage?.progressPercent);
  return total>0&&correctClears>=total*2||progressPercent>=200?'real':'practice';
}

export function captureWorkbookOrderMode(snapshot,stage,item){
  if(snapshot?.stage===stage&&snapshot?.item===item)return snapshot;
  return {stage,item,mode:workbookOrderModeAtProblemStart(stage,item)};
}
