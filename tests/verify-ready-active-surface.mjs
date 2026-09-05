import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');
const student=read('ready/app.js');
const studentHtml=read('ready/index.html');
const admin=read('ready/admin/app.js');
const adminHtml=read('ready/admin/index.html');
const activeCss=`${read('ready/ready.css')}\n${read('ready/design.css')}`;
const edge=read('server/ready/index.ts');
const dormantRoot=resolve(root,'ready/dormant/questions');

const dormantFiles=[
  'README.md','student-runtime.js','admin-runtime.js','interaction-runtime.js',
  'question-renderer.js','question-sheet.js','question-paging.js',
  'question-difficulty.js','question-grading.js','admin-attempt-replay.js','review-export.js',
  'question.css','legacy-design.css',
];
for(const file of dormantFiles)assert(existsSync(resolve(dormantRoot,file)),`Dormant Question asset missing: ${file}`);

assert.doesNotMatch(studentHtml,/student-questions|question-filter|QUESTION SHORTS/,'Active Student HTML must not expose Question UI');
assert.doesNotMatch(adminHtml,/question-import-form|import-question|Question 가져오기|문제 번들/,'Active Admin HTML must not expose Question import UI');
assert.doesNotMatch(student,/dormant\/questions|student_questions|student_question_filters|student_question_queue|submit_attempt|set_question_bookmark|student_review_questions|student_review_export['"]/,'Active Student runtime must not import or call dormant Question paths');
assert.doesNotMatch(admin,/dormant\/questions|import_questions|admin_learning_progress|admin_learning_progress_detail|admin_attempt_replay|questionAttemptReplayHtml/,'Active Admin runtime must not import or call dormant Question paths');
assert.match(student,/call\('student_bootstrap_active'/,'Active Student must use the Question-free bootstrap');
assert.doesNotMatch(student,/call\('student_bootstrap'/,'Active Student must not call the legacy Question-aware bootstrap');
assert.match(student,/student_review['"][\s\S]*student_review_export_active/,'Active Student must use the Question-free Review operations');
assert.match(admin,/admin_workbook_progress['"][\s\S]*admin_workbook_progress_detail['"][\s\S]*admin_workbook_attempt_replay/,'Active Admin must use Workbook-only progress operations');
assert.doesNotMatch(activeCss,/\.(?:question|written-response|written-workspace|writing-target|writing-conditions|choice-matrix|passage-pointer)(?:[-\w]|\s|\{|\[|:)/,'Question-only selectors must not remain in active CSS');

for(const operation of ['student_questions','student_question_filters','student_question_queue','student_review_questions','student_review_export','set_question_bookmark','submit_attempt','admin_learning_progress','admin_learning_progress_detail','admin_attempt_replay','import_questions']){
  assert.match(edge,new RegExp(`case "${operation}"`),`Dormant server operation must remain preserved: ${operation}`);
}
for(const table of ['ready_questions','ready_attempts','ready_question_bookmarks','ready_ai_grading_requests'])assert.match(edge,new RegExp(table),`Historical Question data path must remain preserved: ${table}`);

const activeBootstrap=edge.slice(edge.indexOf('async function activeScopePassages'),edge.indexOf('async function studentPassageAccess'));
assert.match(activeBootstrap,/studentBootstrapActive/,'Question-free Student bootstrap must remain explicit');
assert.doesNotMatch(activeBootstrap,/ready_questions|ready_attempts|eligibleReviewQuestionIds|scopePassages\(/,'Active Student bootstrap must not query dormant Question data');

for(const doc of ['QUESTION_AUTHORING.md','QUESTION_DIFFICULTY.md','QUESTION_IMPORT.md','QUESTION_REPRESENTATION.md','QUESTION_TYPES.md']){
  assert.match(read(`ready/${doc}`),/Status: DORMANT — preserved for future use/);
}
assert.match(read('ready/dormant/questions/README.md'),/Active READY[\s\S]*Dormant Question[\s\S]*Reactivate|Reactivate|Reactivation/);

console.log('READY active surface excludes Question while dormant contracts remain preserved.');
