export function workbookProgressPercent(correctClears,total){
  const clears=Math.max(0,Math.floor(Number(correctClears)||0));
  const pool=Math.max(0,Math.floor(Number(total)||0));
  return pool?Math.floor(clears*100/pool):0;
}

export function workbookProgressVisual(value){
  const percent=Math.max(0,Math.floor(Number(value)||0));
  const remainder=percent%100;
  return {
    percent,
    fill:percent>0&&remainder===0?100:remainder,
    cycle:percent<=100?1:percent<=200?2:percent<=300?3:percent<=500?4:5,
  };
}
