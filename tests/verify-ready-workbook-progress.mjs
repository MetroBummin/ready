import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {clearWorkbookCycleItem,reconcileWorkbookProgress,workbookCycleMilestone,workbookProgressPercent,workbookProgressVisual} from '../ready/workbook-progress.js';
import {gradeLocalWorkbook,gradeWorkbookCorrectionPairs} from '../ready/deterministic-grading.js';

assert.equal(workbookProgressPercent(0,41),0);
assert.equal(workbookProgressPercent(41,41),100);
assert.equal(workbookProgressPercent(43,41),104);
assert.equal(workbookProgressPercent(82,41),200);
assert.deepEqual(reconcileWorkbookProgress(43,42,41),{correctClears:43,progressPercent:104});
assert.deepEqual(reconcileWorkbookProgress(43,44,41),{correctClears:44,progressPercent:107});
assert.deepEqual(workbookProgressVisual(100),{percent:100,fill:100,cycle:1});
assert.deepEqual(workbookProgressVisual(105),{percent:105,fill:5,cycle:2});
assert.deepEqual(workbookProgressVisual(200),{percent:200,fill:100,cycle:2});
assert.deepEqual(workbookProgressVisual(201),{percent:201,fill:1,cycle:3});
assert.deepEqual(workbookProgressVisual(400),{percent:400,fill:100,cycle:4});
assert.deepEqual(workbookProgressVisual(401),{percent:401,fill:1,cycle:5});
assert.deepEqual(workbookProgressVisual(500),{percent:500,fill:100,cycle:5});
assert.deepEqual(workbookProgressVisual(501),{percent:501,fill:1,cycle:6});
assert.equal(workbookCycleMilestone(40,41,41),100);
assert.equal(workbookCycleMilestone(41,42,41),0);
assert.equal(workbookCycleMilestone(81,82,41),200);
assert.equal(workbookCycleMilestone(82,83,41),0);

let cycle={completedCycles:0,currentCycle:1,currentCycleClears:[]};
for(let index=0;index<41;index++)cycle=clearWorkbookCycleItem(cycle,'same-item',41);
assert.equal(cycle.correctClears,1,'repeating one item cannot complete a cycle');
for(let index=1;index<40;index++)cycle=clearWorkbookCycleItem(cycle,`item-${index}`,41);
for(let index=0;index<20;index++)cycle=clearWorkbookCycleItem(cycle,'item-1',41);
assert.equal(cycle.correctClears,40,'40 unique clears plus duplicates must remain below 100%');
cycle=clearWorkbookCycleItem(cycle,'item-40',41);
assert.deepEqual(cycle,{completedCycles:1,currentCycle:2,currentCycleClears:[],correctClears:41,advanced:true,completedCycle:true});
for(let index=0;index<41;index++)cycle=clearWorkbookCycleItem(cycle,`item-${index}`,41);
assert.equal(cycle.correctClears,82,'a second full unique cycle must be exactly 200%');
for(let index=0;index<10;index++)cycle=clearWorkbookCycleItem(cycle,`third-${index}`,41);
assert.equal(workbookProgressPercent(cycle.correctClears,41),224,'two cycles plus 10 of 41 must be 224%');

const incomplete=gradeLocalWorkbook({mode:'deterministic',answers:['one','two']},['one','']);
assert.equal(incomplete.valid,true);
assert.equal(incomplete.correct,false);
assert.deepEqual(incomplete.slotResults,[true,false]);
const empty=gradeLocalWorkbook({mode:'deterministic',answers:['answer']},['']);
assert.equal(empty.valid,true);
assert.equal(empty.correct,false);
const pair=gradeWorkbookCorrectionPairs(['moving','to move'],['',''],{allowIncomplete:true});
assert.equal(pair.valid,true);
assert.equal(pair.correct,false);

const [app,edge,factory,studio,css,designCss,migration]=await Promise.all([
  readFile(new URL('../ready/app.js',import.meta.url),'utf8'),
  readFile(new URL('../server/ready/index.ts',import.meta.url),'utf8'),
  readFile(new URL('../server/ready/workbook-factory.mjs',import.meta.url),'utf8'),
  readFile(new URL('../ready/admin/studio-ui.js',import.meta.url),'utf8'),
  readFile(new URL('../ready/admin/studio.css',import.meta.url),'utf8'),
  readFile(new URL('../ready/design.css',import.meta.url),'utf8'),
  readFile(new URL('../supabase/migrations/20260907210000_ready_workbook_unique_cycle_progress.sql',import.meta.url),'utf8'),
]);
assert.match(app,/data-submit-workbook>제출<\/button>/,'submit must be enabled from first render');
assert.doesNotMatch(app,/data-submit-workbook[^>]*disabled/,'response completeness must not disable submit');
assert.doesNotMatch(app,/workbook-stage-gauge/,'the stage card itself must be the progress gauge');
assert.match(designCss,/linear-gradient\(to right,var\(--workbook-progress-fill\) 0 var\(--workbook-progress\)/,'stage progress must fill the full card background');
assert.doesNotMatch(app,/reader-actions/,'Passage must not end with the old Workbook start card');
assert.doesNotMatch(app,/reader-learning|reader-workbook-sheet|data-workbook-sheet/,'Passage must contain only the reader, without a learning dock or sheet');
assert.doesNotMatch(designCss,/reader-learning|reader-workbook-sheet/,'removed Passage dock and fade styles must not remain dormant');
assert.match(app,/readerGestureDecision\(\{maxDistance:pointer\.maxDistance,scrollChanged:pointer\.scrollChanged,cancelled,released:true,sentenceEnabled:false\}\)/,'navigation must share the Reader scroll threshold');
assert.match(app,/guardNavTailClick[\s\S]*decision!==\'SCROLL\'[\s\S]*stopImmediatePropagation/,'a scroll gesture tail must not activate a navigation click');
assert.match(app,/navigationIsCurrent\(navigation\)/,'late async responses must not replace the current student screen');
assert.match(app,/clearWorkbookCycleItem\(stage,item\.key,stage\.total\)/,'local progress must count a unique item once per cycle');
assert.match(app,/workbookCycleMilestone\(before,stage\.correctClears,stage\.total\)/,'a completed unique cycle must raise a milestone');
assert.match(app,/WORKBOOK_PROGRESS_FLOOR/,'optimistic unique-cycle state must survive cache and server reconciliation');
assert.match(app,/data-workbook-repeat[\s\S]*data-workbook-other/,'milestone must offer repeat and other-learning actions');
assert.match(designCss,/progress-cycle-6/,'500% and above must use the deepest progress color');
assert.match(app,/Array\.from\(\{length:item\.slotCount\}/,'incomplete positions must be preserved');
assert.match(edge,/item\.kind === "translation_ai" \|\| item\.semanticType === "translation"/,'semantic translation must use AI grading');
assert.match(edge,/responses\[0\][\s\S]*callLegacyWorkbookTranslationGrade/,'non-empty translation must reach semantic AI grading');
assert.match(edge,/해석을 입력하지 않아 채점할 수 없습니다/,'empty translation must produce explicit wrong feedback without inference');
assert.match(edge,/recentStage: Number\(attempts\[0\]\?\.stage\)\|\|null/,'Passage Dock must resume the latest stage');
assert.match(factory,/kind: 'translation_ai', semanticType: 'translation'/,'new semantic translation items must advertise AI grading');
assert.match(studio,/✓ \$\{esc\(target\.correct/,'grammar authoring must expose the correct side');
assert.match(studio,/target\.distractor\|\|'오답 필요'/,'grammar authoring must expose a missing or actual distractor');
assert.match(studio,/data-delete-target/,'grammar targets must be removable');
assert.match(studio,/검수 완료 · 미발행/,'review confirmation and publication must not be conflated');
assert.match(css,/target-group-0/);
assert.match(css,/target-group-1/);
assert.match(migration,/primary key \([\s\S]*progress_key, cycle_number, item_key/,'database progress must enforce one item clear per cycle');
assert.match(migration,/on conflict do nothing/,'duplicate clears in a cycle must not advance progress');
assert.match(migration,/order by ranked\.created_at, ranked\.id/,'historical correct attempts must be replayed chronologically');
assert.match(migration,/where a\.correct is true[\s\S]*replay_stage_item_count > 0/,'only catalog-backed correct history may be replayed');
assert.doesNotMatch(migration,/update public\.ready_workbook_attempts/,'append-only attempts must never be mutated during backfill');

console.log('READY infinite Workbook progress, incomplete submit, semantic translation and Authoring QA passed.');
