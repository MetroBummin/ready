export const LEARNING_PERIODS=Object.freeze(['today','7d','30d']);

export function learningPeriodStart(period='7d',now=new Date()){
  const key=LEARNING_PERIODS.includes(period)?period:'7d',kstOffset=9*60*60*1000,kst=new Date(now.getTime()+kstOffset);
  const todayUtc=Date.UTC(kst.getUTCFullYear(),kst.getUTCMonth(),kst.getUTCDate())-kstOffset;
  const days=key==='today'?1:key==='30d'?30:7;
  return new Date(todayUtc-(days-1)*24*60*60*1000);
}

export function attemptMetrics(attempts=[]){
  const total=attempts.length,correct=attempts.filter(attempt=>attempt.correct===true).length,wrong=total-correct;
  return {total,correct,wrong,accuracy:total?Math.round(correct/total*100):null};
}

export function progressAccuracy(correct,total){
  const denominator=Number(total)||0;
  return denominator?Math.round((Number(correct)||0)/denominator*100):null;
}

export function latestAttemptAt(questionAttempts=[],workbookAttempts=[]){
  const timestamps=[...questionAttempts,...workbookAttempts].map(attempt=>Date.parse(attempt.created_at||attempt.createdAt||'')).filter(Number.isFinite);
  return timestamps.length?new Date(Math.max(...timestamps)).toISOString():null;
}

export function groupAttemptCounts(attempts=[],keyOf=attempt=>attempt.itemId){
  const groups=new Map();
  for(const attempt of attempts){const key=keyOf(attempt);if(!key)continue;const current=groups.get(key)||{attempts:0,wrong:0};current.attempts+=1;if(attempt.correct===false)current.wrong+=1;groups.set(key,current);}
  return groups;
}
