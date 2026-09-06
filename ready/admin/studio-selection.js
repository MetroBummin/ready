// One interaction shared by every authored step. tokenEnd is exclusive.
export function selectToken(targets,activeIndex,tokenIndex) {
  const next=structuredClone(targets),active=next[activeIndex];
  if(active){const span=active.span;
    if(tokenIndex===span.tokenStart-1||tokenIndex===span.tokenEnd){
      const overlap=next.findIndex((t,i)=>i!==activeIndex&&tokenIndex>=t.span.tokenStart&&tokenIndex<t.span.tokenEnd);
      if(overlap<0){span.tokenStart=Math.min(span.tokenStart,tokenIndex);span.tokenEnd=Math.max(span.tokenEnd,tokenIndex+1);return {targets:next,activeIndex};}
    }
    if(tokenIndex===span.tokenStart||tokenIndex===span.tokenEnd-1){
      if(span.tokenEnd-span.tokenStart===1){next.splice(activeIndex,1);return {targets:next,activeIndex:null};}
      if(tokenIndex===span.tokenStart)span.tokenStart++;else span.tokenEnd--;
      return {targets:next,activeIndex};
    }
    if(tokenIndex>span.tokenStart&&tokenIndex<span.tokenEnd-1)return {targets:next,activeIndex};
  }
  const existing=next.findIndex(t=>tokenIndex>=t.span.tokenStart&&tokenIndex<t.span.tokenEnd);
  if(existing>=0)return {targets:next,activeIndex:existing};
  next.push({span:{tokenStart:tokenIndex,tokenEnd:tokenIndex+1}});
  return {targets:next,activeIndex:next.length-1};
}
