import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../ready/app.js',import.meta.url),'utf8');
const writing=readFileSync(new URL('../ready/workbook-writing-ui.js',import.meta.url),'utf8');

assert.match(app,/WORKBOOK_AUTOFOCUS_TYPES=new Set\(\['korean_blank','english_blank','verb_form','translation','writing'\]\)/,'Only the five requested typing stages should opt into automatic focus');
assert.match(app,/function workbookFocusFirstSlot[\s\S]{0,700}setAttribute\('autofocus',''\)[\s\S]{0,300}focus\(\{preventScroll:true\}\)/,'Typing stages must mark and focus their first available field immediately');
assert.match(app,/currentCard\.after\(nextCard\);if\(focus&&preserveKeyboard\)workbookFocusFirstSlot\(nextCard,item,\{preferEmpty\}\);currentCard\.remove\(\)/,'The next input must receive focus before the previous problem DOM is removed');
assert.doesNotMatch(app,/async function moveWorkbook|async function setWorkbookStage/,'Problem and stage navigation must not wait on a network response before rendering or focus');
assert.match(app,/submitWorkbook\(\{autoAdvance:true\}\)/,'Enter must submit through the auto-advance path');
assert.match(app,/autoAdvance&&grade\.correct&&!session\.milestone&&workbookShouldAutofocus\(item\)[\s\S]{0,120}moveWorkbook\(1,\{focus:true,preserveKeyboard:true\}\)/,'A locally correct typing answer must move and transfer focus synchronously');
assert.match(app,/session\.aiPending\[item\.key\]=true;delete session\.aiErrors\[item\.key\];refreshWorkbookAiStatus\(session,item\)/,'Semantic translation grading must keep its focused textarea mounted while awaiting AI');
assert.match(app,/autoAdvance&&result\.correct&&!session\.milestone&&workbookShouldAutofocus\(item\)[\s\S]{0,120}moveWorkbook\(1,\{focus:true,preserveKeyboard:true\}\)/,'A correct semantic translation must reuse the same focus-preserving transition');
assert.match(app,/if\(!result\)return submitWorkbook\(\{autoAdvance:true\}\);if\(result\.correct\)return moveWorkbook\(1,\{focus:true,preserveKeyboard:true\}\);return retryWorkbook\(\)/,'Wrong answers must stay put while correct answers advance');
assert.match(app,/enterkeyhint="done"/,'Blank and translation controls must expose a mobile completion key');
assert.match(writing,/enterkeyhint="done"/,'Writing must expose a mobile completion key');
assert.doesNotMatch(app,/WORKBOOK_AUTOFOCUS_TYPES[^\n]*(grammar_choice|word_order)/,'Choice and ordering stages must not opt into autofocus');

console.log('READY Workbook cross-platform keyboard continuity gate passed.');
