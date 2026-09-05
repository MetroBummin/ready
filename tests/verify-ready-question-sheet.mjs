import assert from 'node:assert/strict';
import fs from 'node:fs';
import { QUESTION_SIDE_PANEL_MEDIA, QUESTION_SHEET_STATES, questionSheetSnapState, questionUsesSidePanel } from '../ready/question-sheet.js';

const app=fs.readFileSync(new URL('../ready/app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../ready/design.css',import.meta.url),'utf8');

assert.equal(QUESTION_SIDE_PANEL_MEDIA,'(min-width:1000px), (min-width:761px) and (pointer:fine)');
assert.deepEqual([...QUESTION_SHEET_STATES],['collapsed','expanded'],'Question sheet must have exactly two persisted states');
assert.equal(questionUsesSidePanel(query=>({matches:query===QUESTION_SIDE_PANEL_MEDIA})),true);
assert.equal(questionUsesSidePanel(()=>({matches:false})),false);
assert.equal(questionSheetSnapState('collapsed',-72),'expanded','upward drag expands a collapsed sheet');
assert.equal(questionSheetSnapState('collapsed',-30),'collapsed','short drag snaps back');
assert.equal(questionSheetSnapState('expanded',72),'collapsed','downward drag collapses an expanded sheet');
assert.equal(questionSheetSnapState('expanded',72,{cancelled:true}),'expanded','cancelled drag restores its starting state');

assert.match(app,/data-question-sheet-state="\$\{sheetState\}"/,'Question layout owns one two-state sheet');
assert.match(app,/data-question-sheet-drag[\s\S]*data-question-sheet-content/,'One Question DOM must contain the drag header and answer content');
assert.match(app,/questionRoot\.addEventListener\('pointerdown'/,'Sheet drag listeners must mount once on the persistent Question root');
assert.match(app,/questionSheetDragExcluded='[^']*input,textarea,select,button[^']*\[data-question-choice\][^']*reader-inline-source[^']*\[data-question-sheet-content\]'/,'Controls, word lookup, choices, and scrollable content must not begin sheet drag');
assert.match(app,/questionPagingTarget[^\n]*\[data-question-sheet\]/,'Question sheet and question pager must not own the same pointer sequence');
assert.match(app,/questionRoot\.addEventListener\('click',event=>\{if\(!event\.target\.closest\?\.\('\[data-question-sheet-scrim\]'/,'Scrim must have one delegated click listener on the persistent Question root');
assert.match(app,/data-question-sheet-scrim[^\n]*stopPropagation\(\)[^\n]*stopImmediatePropagation\(\)[^\n]*setQuestionSheetState\('collapsed'\)/,'Scrim click must be fully consumed before collapsing the sheet');
assert.match(app,/setPointerCapture[^\n]*question-sheet-dragging/,'Only an accepted sheet drag captures its pointer');
assert.match(app,/releasePointerCapture/,'Sheet pointer capture must be released');
assert.match(app,/translate3d\(0,\$\{next\}px,0\)/,'Live dragging must use a compositor-friendly transform');
assert.doesNotMatch(app,/ResizeObserver|MutationObserver/,'Question sheet must not introduce observers');

assert.match(css,/@media \(min-width:1000px\), \(min-width:761px\) and \(pointer:fine\)/,'Breeze responsive ownership breakpoint must be expressed in CSS');
assert.match(css,/\.question-workspace\.has-passage\{[^}]*grid-template-columns/,'Side panel mode must show reading and solving regions together');
assert.match(css,/\.question-solving-surface\{[\s\S]*transform:translate3d\(0,calc\(100% - var\(--question-sheet-peek\)\),0\)/,'Touch layout must default to a collapsed bottom sheet');
assert.match(css,/\.question-sheet-content\{[^}]*overflow-y:auto[^}]*touch-action:pan-y/,'Expanded sheet content must own vertical scrolling');
assert.match(css,/\.question-sheet-header\{[^}]*touch-action:pan-x/,'Only the sheet header must own vertical dragging');
assert.match(css,/\.question-sheet-scrim\{[^}]*position:fixed[^}]*touch-action:none/,'Expanded sheet must use a dedicated full-screen tap owner');
assert.match(css,/data-question-sheet-state="expanded"\] \.question-sheet-scrim\{[^}]*pointer-events:auto/,'Scrim must only receive taps while the sheet is expanded');

console.log('READY responsive Question sheet ownership verified');
