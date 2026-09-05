import assert from 'node:assert/strict';
import fs from 'node:fs';
import { QUESTION_PAGE_SWIPE_MIN, QUESTION_PAGE_SWIPE_RATIO, questionPageDirection } from '../ready/question-paging.js';

const app=fs.readFileSync(new URL('../ready/app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../ready/design.css',import.meta.url),'utf8');
const baseCss=fs.readFileSync(new URL('../ready/ready.css',import.meta.url),'utf8');

assert.equal(QUESTION_PAGE_SWIPE_MIN,72);
assert.equal(QUESTION_PAGE_SWIPE_RATIO,1.35);
assert.equal(questionPageDirection(-90,8),1,'left swipe advances one question');
assert.equal(questionPageDirection(90,8),-1,'right swipe returns one question');
assert.equal(questionPageDirection(-90,80),0,'diagonal movement must not page');
assert.equal(questionPageDirection(20,100,{axis:'y'}),0,'vertical reading scroll must not page');
assert.equal(questionPageDirection(-90,8,{cancelled:true}),0,'cancelled gestures must not page');
assert.match(app,/questionPagingTarget[^\n]*\[data-question-choice\][^\n]*reader-inline-source/,'Interactive answers and inline lookup own their gestures');
assert.match(app,/Math\.abs\(dx\)>Math\.abs\(dy\)\*1\.25[^\n]*axis='x'/,'Horizontal intent must be locked before preventing browser movement');
assert.doesNotMatch(app,/atQuestionBoundary|beginShortsTouch|ArrowUp|ArrowDown|data-question-prev|data-question-next/,'Vertical question navigation must be removed');
assert.match(css,/question-layout\{[^}]*touch-action:pan-y/,'Question pages must preserve native vertical scrolling');
assert.doesNotMatch(css,/\.shorts-cue/,'The old vertical navigation cue must be removed');
assert.doesNotMatch(baseCss,/question-topline|question-state|shorts-cue/,'Removed question chrome must not leave active layout hooks');

console.log('READY horizontal question paging and vertical scroll ownership verified');
