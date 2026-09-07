import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {workbookProgressPercent,workbookProgressVisual} from '../ready/workbook-progress.js';
import {gradeLocalWorkbook,gradeWorkbookCorrectionPairs} from '../ready/deterministic-grading.js';

assert.equal(workbookProgressPercent(0,41),0);
assert.equal(workbookProgressPercent(41,41),100);
assert.equal(workbookProgressPercent(43,41),104);
assert.equal(workbookProgressPercent(82,41),200);
assert.deepEqual(workbookProgressVisual(100),{percent:100,fill:100,cycle:1});
assert.deepEqual(workbookProgressVisual(105),{percent:105,fill:5,cycle:2});
assert.deepEqual(workbookProgressVisual(200),{percent:200,fill:100,cycle:2});
assert.deepEqual(workbookProgressVisual(201),{percent:201,fill:1,cycle:3});
assert.deepEqual(workbookProgressVisual(501),{percent:501,fill:1,cycle:5});

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
  readFile(new URL('../supabase/migrations/20260907170000_ready_workbook_infinite_progress.sql',import.meta.url),'utf8'),
]);
assert.match(app,/data-submit-workbook>제출<\/button>/,'submit must be enabled from first render');
assert.doesNotMatch(app,/data-submit-workbook[^>]*disabled/,'response completeness must not disable submit');
assert.doesNotMatch(app,/workbook-stage-gauge/,'the stage card itself must be the progress gauge');
assert.match(designCss,/linear-gradient\(to right,var\(--workbook-progress-fill\) 0 var\(--workbook-progress\)/,'stage progress must fill the full card background');
assert.match(app,/Array\.from\(\{length:item\.slotCount\}/,'incomplete positions must be preserved');
assert.match(edge,/item\.kind === "translation_ai" \|\| item\.semanticType === "translation"/,'semantic translation must use AI grading');
assert.match(edge,/responses\[0\][\s\S]*callLegacyWorkbookTranslationGrade/,'non-empty translation must reach semantic AI grading');
assert.match(edge,/해석을 입력하지 않아 채점할 수 없습니다/,'empty translation must produce explicit wrong feedback without inference');
assert.match(factory,/kind: 'translation_ai', semanticType: 'translation'/,'new semantic translation items must advertise AI grading');
assert.match(studio,/✓ \$\{esc\(target\.correct/,'grammar authoring must expose the correct side');
assert.match(studio,/target\.distractor\|\|'오답 필요'/,'grammar authoring must expose a missing or actual distractor');
assert.match(studio,/data-delete-target/,'grammar targets must be removable');
assert.match(studio,/검수 완료 · 미발행/,'review confirmation and publication must not be conflated');
assert.match(css,/target-group-0/);
assert.match(css,/target-group-1/);
assert.match(migration,/where correct is true/);
assert.match(migration,/after insert on public\.ready_workbook_attempts/);

console.log('READY infinite Workbook progress, incomplete submit, semantic translation and Authoring QA passed.');
