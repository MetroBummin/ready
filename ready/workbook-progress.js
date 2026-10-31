export function workbookProgressPercent(correctClears,total){
  const clears=Math.max(0,Math.floor(Number(correctClears)||0));
  const pool=Math.max(0,Math.floor(Number(total)||0));
  return pool?Math.floor(clears*100/pool):0;
}

// Mirrors the database trigger `ready_record_workbook_cycle_clear`: an item
// counts once per cycle, and a cycle closes when every item has been cleared.
export function clearWorkbookCycleItem({completedCycles=0,currentCycle=1,currentCycleClears=[]}={},itemKey,total){
  const size=Math.max(0,Math.floor(Number(total)||0)),cycles=Math.max(0,Math.floor(Number(completedCycles)||0)),cycle=Math.max(1,Math.floor(Number(currentCycle)||1)),keys=new Set((currentCycleClears||[]).map(String));
  if(!size||!itemKey)return {completedCycles:cycles,currentCycle:cycle,currentCycleClears:[...keys],correctClears:cycles*size+keys.size,advanced:false,completedCycle:false};
  const before=keys.size;keys.add(String(itemKey));
  if(keys.size===before)return {completedCycles:cycles,currentCycle:cycle,currentCycleClears:[...keys],correctClears:cycles*size+keys.size,advanced:false,completedCycle:false};
  if(keys.size>=size)return {completedCycles:cycles+1,currentCycle:cycle+1,currentCycleClears:[],correctClears:(cycles+1)*size,advanced:true,completedCycle:true};
  return {completedCycles:cycles,currentCycle:cycle,currentCycleClears:[...keys],correctClears:cycles*size+keys.size,advanced:true,completedCycle:false};
}
