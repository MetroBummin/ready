export const QUESTION_SIDE_PANEL_MEDIA='(min-width:1000px), (min-width:761px) and (pointer:fine)';
export const QUESTION_SHEET_STATES=Object.freeze(['collapsed','expanded']);

export function questionUsesSidePanel(matchMediaFn=globalThis.matchMedia){
  return typeof matchMediaFn==='function'&&matchMediaFn.call(globalThis,QUESTION_SIDE_PANEL_MEDIA).matches;
}

export function questionSheetSnapState(startState,deltaY,{cancelled=false,threshold=56}={}){
  const state=QUESTION_SHEET_STATES.includes(startState)?startState:'collapsed';
  if(cancelled||Math.abs(deltaY)<threshold)return state;
  if(state==='collapsed'&&deltaY<0)return 'expanded';
  if(state==='expanded'&&deltaY>0)return 'collapsed';
  return state;
}
