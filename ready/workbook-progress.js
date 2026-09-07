export function workbookProgressPercent(correctClears,total){
  const clears=Math.max(0,Math.floor(Number(correctClears)||0));
  const pool=Math.max(0,Math.floor(Number(total)||0));
  return pool?Math.floor(clears*100/pool):0;
}

export function reconcileWorkbookProgress(currentClears,incomingClears,total){
  const correctClears=Math.max(0,Math.floor(Number(currentClears)||0),Math.floor(Number(incomingClears)||0));
  return {correctClears,progressPercent:workbookProgressPercent(correctClears,total)};
}

export function workbookProgressVisual(value){
  const percent=Math.max(0,Math.floor(Number(value)||0));
  const remainder=percent%100;
  return {
    percent,
    fill:percent>0&&remainder===0?100:remainder,
    cycle:percent<=100?1:percent<=200?2:percent<=300?3:percent<=400?4:percent<=500?5:6,
  };
}

export function workbookCycleMilestone(previousClears,nextClears,total){
  const pool=Math.max(0,Math.floor(Number(total)||0));
  if(!pool)return 0;
  const previous=Math.max(0,Math.floor(Number(previousClears)||0));
  const next=Math.max(previous,Math.floor(Number(nextClears)||0));
  const previousCycle=Math.floor(previous/pool),nextCycle=Math.floor(next/pool);
  return nextCycle>previousCycle?nextCycle*100:0;
}

export function clearWorkbookCycleItem({completedCycles=0,currentCycle=1,currentCycleClears=[]}={},itemKey,total){
  const size=Math.max(0,Math.floor(Number(total)||0)),cycles=Math.max(0,Math.floor(Number(completedCycles)||0)),cycle=Math.max(1,Math.floor(Number(currentCycle)||1)),keys=new Set((currentCycleClears||[]).map(String));
  if(!size||!itemKey)return {completedCycles:cycles,currentCycle:cycle,currentCycleClears:[...keys],correctClears:cycles*size+keys.size,advanced:false,completedCycle:false};
  const before=keys.size;keys.add(String(itemKey));
  if(keys.size===before)return {completedCycles:cycles,currentCycle:cycle,currentCycleClears:[...keys],correctClears:cycles*size+keys.size,advanced:false,completedCycle:false};
  if(keys.size>=size)return {completedCycles:cycles+1,currentCycle:cycle+1,currentCycleClears:[],correctClears:(cycles+1)*size,advanced:true,completedCycle:true};
  return {completedCycles:cycles,currentCycle:cycle,currentCycleClears:[...keys],correctClears:cycles*size+keys.size,advanced:true,completedCycle:false};
}
