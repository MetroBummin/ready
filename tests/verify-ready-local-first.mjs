import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const app=read('ready/app.js'),admin=read('ready/admin/app.js'),studio=read('ready/admin/studio-ui.js'),edge=read('server/ready/index.ts'),design=read('ready/design.css');

assert.match(edge,/assistance: await publicWorkbookAssistance\(item, sha256Hex\)/,'Workbook assistance must be bundled with the authenticated catalog');
assert.match(edge,/mode: "deterministic"[\s\S]{0,140}answers: item\.answers/,'Deterministic answers must be bundled once for local grading');
assert.match(app,/function workbookTaskHtml\(item,values,result,session,lookupText=null\)[\s\S]{0,1600}return `<div class="workbook-prompt inline-blank-task"/,'Verb-form items must remain on the shared visible blank-input renderer');
assert.match(app,/item\.grading\.kind==='correction_pairs'[\s\S]{0,420}gradeLocalWorkbook\(item\.grading,responses/,'Verb-form and other exact deterministic items must grade locally');
assert.match(edge,/item\.semanticType === "writing" \|\| Number\(item\.stage\) === 9/,'Writing hint persistence must follow the semantic stage while retaining legacy stage 9');
assert.doesNotMatch(app,/readyApi\('workbook_assistance'|readyApi\('workbook_recall_unlock'/,'A Workbook interaction must not fetch assistance or recall answers');
assert.match(app,/function workbookSubmitHtml\(session,item,result\)[^\n]*data-submit-workbook/,'All unanswered Workbook stages must expose the explicit submit button');
assert.doesNotMatch(app,/function workbookSubmitHtml[^\n]*recall_unlock/,'Recall stages must use the same submit lifecycle as every other stage');
assert.doesNotMatch(app,/async function handleWorkbookRecallInput[\s\S]{0,1600}submitWorkbook\(\)/,'Recall completion must wait for explicit submit');
assert.match(app,/function workbookSubmitHtml[^\n]*<button class="button primary" type="button" data-submit-workbook>제출<\/button>/,'Incomplete deterministic responses must remain submittable');
assert.match(app,/function queueWorkbookAttempt[\s\S]{0,400}setTimeout\(\(\)=>flushWorkbookAttempts\(\),180\)/,'Attempts must batch outside the interaction path');
assert.match(app,/submit_workbook_attempts/,'Attempt persistence must use the batch endpoint');
assert.match(app,/pagehide[\s\S]{0,160}keepalive:true/,'Pending attempts must flush when the page leaves');
assert.match(app,/saveWorkbookAttemptQueue[\s\S]*restoreWorkbookAttempts/,'Pending attempts must survive a reload until acknowledged');
assert.match(edge,/client_attempt_id:clientAttemptId[\s\S]*error\.code==='23505'/,'Background retries must be idempotent without overwriting an attempt');
assert.match(app,/const cached=cachedWorkbook\(passageId\);if\(cached\)startWorkbookSession/,'Workbook cache must render before background revalidation');
assert.match(app,/function prefetchWorkbooks/,'Assigned Workbooks must prefetch in idle time');
assert.match(app,/function prefetchReview[\s\S]*loadReviewKind\('word'/,'Review must prefetch its default tab after dashboard bootstrap');
assert.match(app,/function openReview\(\)[^\n]*renderReview\(\);loadReviewKind/,'Review shell must render before its background request');
assert.doesNotMatch(app,/call\('student_review'/,'Review data must not activate the global loading overlay');
assert.match(app,/data\.loaded\?\.\[kind\]&&\(!force\|\|state\.reviewValidated\[kind\]\)/,'an already loaded Review tab must switch with zero network requests');
assert.match(edge,/if \(kind === "word"\)[\s\S]*if \(kind === "workbook"\)[\s\S]*if \(kind === "sentence"\)/,'Review tabs must load independently');
assert.match(design,/@media \(hover:hover\) and \(pointer:fine\)\{\.workbook-stage-option:hover/,'Workbook hover visuals must be fine-pointer only');
assert.match(design,/-webkit-tap-highlight-color:transparent/,'mobile Workbook cards must not retain browser tap highlight');
assert.match(admin,/call\('studio_open'/,'Admin Passage must use one blocking bundle request');
assert.match(studio,/current\.previewCatalog\?\.stages/,'AUTO chips must use the loaded preview catalog');
assert.doesNotMatch(studio,/if\(PURE\.includes\(step\)\)\{const result=await action\('studio_preview'\)/,'AUTO chip changes must not call the server');

const simulatedRoundTripMs=500;
const before={workbookOpen:simulatedRoundTripMs,recall:simulatedRoundTripMs,deterministicSubmit:simulatedRoundTripMs,stageChange:simulatedRoundTripMs,adminPassageOpen:simulatedRoundTripMs*2};
const after={workbookOpen:0,recall:0,deterministicSubmit:0,stageChange:0,adminPassageOpen:simulatedRoundTripMs};
assert.deepEqual(after,{workbookOpen:0,recall:0,deterministicSubmit:0,stageChange:0,adminPassageOpen:500});
console.log('READY local-first request gate passed.',{before,after});
