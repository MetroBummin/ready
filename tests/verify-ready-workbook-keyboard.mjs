import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {progressiveOrderState,workbookEnterAction,workbookOrderAnswerIndexes} from '../ready/workbook-interaction.js';

const app=readFileSync(new URL('../ready/app.js',import.meta.url),'utf8');
const writing=readFileSync(new URL('../ready/workbook-writing-ui.js',import.meta.url),'utf8');

assert.match(app,/WORKBOOK_AUTOFOCUS_TYPES=new Set\(\['korean_blank','english_blank','verb_form','translation','writing'\]\)/,'Only the five requested typing stages should opt into automatic focus');
assert.match(app,/function workbookFocusFirstSlot[\s\S]{0,700}setAttribute\('autofocus',''\)[\s\S]{0,300}focus\(\{preventScroll:true\}\)/,'Typing stages must mark and focus their first available field immediately');
assert.match(app,/currentCard\.after\(nextCard\);if\(focus&&preserveKeyboard\)workbookFocusFirstSlot\(nextCard,item,\{preferEmpty\}\);currentCard\.remove\(\)/,'The next input must receive focus before the previous problem DOM is removed');
assert.doesNotMatch(app,/async function moveWorkbook|async function setWorkbookStage/,'Problem and stage navigation must not wait on a network response before rendering or focus');
assert.deepEqual(workbookEnterAction(['one','',''],0),{type:'focus',index:1},'Enter must move to the next empty slot');
assert.deepEqual(workbookEnterAction(['one','two','three'],2),{type:'submit'},'Enter on a complete multi-slot answer must submit');
assert.deepEqual(workbookEnterAction(['done'],0,{correct:true}),{type:'next'},'A second Enter after green feedback must move next');
assert.deepEqual(workbookEnterAction(['wrong'],0,{correct:false}),{type:'retry'},'A second Enter after red feedback must retry in place');
assert.match(app,/const action=workbookEnterAction\(workbookValues\(session,item\)/,'Every input Enter must use the shared slot-submit-next state machine');
assert.match(app,/if\(action\.type==='submit'\)return submitWorkbook\(\);if\(action\.type==='next'\)return moveWorkbook\(1,\{focus:true,preserveKeyboard:true\}\)/,'First Enter submits and second correct Enter transfers focus to the next card');
assert.match(app,/session\.aiPending\[item\.key\]=true;delete session\.aiErrors\[item\.key\];refreshWorkbookAiStatus\(session,item\)/,'Semantic translation grading must keep its focused textarea mounted while awaiting AI');
assert.match(app,/refreshWorkbookOutcome\(session,item\)/,'Local and AI results must update the mounted card in place');
assert.doesNotMatch(app,/input\.readOnly=true/,'Recall completion must not make the current field readonly before transferring focus');
assert.match(app,/input\.dataset\.recallComplete='true'[\s\S]{0,220}next\.focus/,'Recall completion must transfer focus without replacing input DOM');
assert.match(app,/enterkeyhint="\$\{slot<item\.slotCount-1\?'next':'done'\}"/,'Multi-slot controls must expose next and done keyboard hints');
assert.match(app,/enterkeyhint="done"/,'Blank and translation controls must expose a mobile completion key');
assert.match(writing,/enterkeyhint="done"/,'Writing must expose a mobile completion key');
assert.doesNotMatch(app,/WORKBOOK_AUTOFOCUS_TYPES[^\n]*(grammar_choice|word_order)/,'Choice and ordering stages must not opt into autofocus');

const duplicateGroup=['to','learn','to','read','well','today','fast'];
assert.deepEqual(workbookOrderAnswerIndexes(duplicateGroup,'to learn to read well today fast'),[0,1,2,3,4,5,6],'Repeated chips must retain identity by index');
const order=progressiveOrderState(duplicateGroup,'to learn to read well today fast',[],5);
assert.equal(order.visible.length,5,'Progressive ordering must show at most five chips by default');
assert(order.visible.includes(order.nextExpected),'The next correct chip must always be visible');
assert.match(app,/chipIndex!==progressive\.nextExpected[\s\S]{0,220}submitWorkbook\(\)/,'A wrong ordering chip must immediately finalize the local attempt');
assert.match(app,/hintUsed\?'힌트 사용함':'힌트 보기'/,'Writing hint must become visibly exhausted after its one use');
assert.match(app,/data-workbook-submit[\s\S]{0,300}data-workbook-hint[\s\S]{0,300}data-submit-workbook/,'Writing hint must live beside submit');

console.log('READY Workbook cross-platform keyboard continuity gate passed.');
