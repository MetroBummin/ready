import assert from 'node:assert/strict';
import fs from 'node:fs';
import { groupWorkbookStages } from '../ready/workbook-stage-picker.js';

const stages = [
  { semanticType: 'writing', locked: false, token: 'writing' },
  { semanticType: 'unknown_new_type', locked: true, title: '새 유형', token: 'unknown-one' },
  { semanticType: 'content_claim', locked: false, token: 'claim' },
  { semanticType: 'grammar_choice', locked: true, token: 'grammar' },
  { semanticType: 'translation', locked: false, token: 'translation' },
  { semanticType: 'word_order', locked: false, token: 'order' },
  { semanticType: 'korean_blank', locked: false, token: 'ko' },
  { semanticType: 'verb_form', locked: false, token: 'verb' },
  { semanticType: 'english_blank', locked: false, token: 'en' },
  { semanticType: 'unknown_second_type', locked: false, title: '다른 유형', token: 'unknown-two' },
];
const grouped = groupWorkbookStages(stages);
assert.deepEqual(grouped.map(group => group.title), ['기본 이해', '문법', '암기', '기타 학습']);
assert.deepEqual(grouped[0].stages.map(stage => [stage.semanticType, stage.label, stage.icon]), [
  ['content_claim', '내용일치', '☑'],
  ['korean_blank', '우리말 빈칸', '가'],
  ['english_blank', '영어 빈칸', 'A'],
  ['translation', '해석', '▤'],
]);
assert.deepEqual(grouped[1].stages.map(stage => stage.semanticType), ['verb_form', 'grammar_choice']);
assert.deepEqual(grouped[2].stages.map(stage => stage.semanticType), ['word_order', 'writing']);
assert.deepEqual(grouped[3].stages.map(stage => stage.semanticType), ['unknown_new_type', 'unknown_second_type'], 'Unknown types must remain together in one fallback group.');
const writing = grouped[2].stages.find(stage => stage.semanticType === 'writing');
const grammar = grouped[1].stages.find(stage => stage.semanticType === 'grammar_choice');
assert.equal(writing.stage, stages[0]);
assert.equal(writing.stageIndex, 0);
assert.equal(writing.locked, false);
assert.equal(grammar.stageIndex, 3);
assert.equal(grammar.locked, true);
assert.deepEqual(groupWorkbookStages([]), []);

const app = fs.readFileSync(new URL('../ready/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../ready/design.css', import.meta.url), 'utf8');
const harness = fs.readFileSync(new URL('./workbook-flow-harness.html', import.meta.url), 'utf8');
assert.match(app, /groupWorkbookStages\(session\.data\.stages\)/, 'Picker must derive categories from the current stage array without changing it.');
assert.match(app, /data-workbook-stage="\$\{stageIndex\}"/, 'Grouped cards must retain their original stage index for entry.');
assert.match(app, /workbook-stage-category/, 'Picker must render large category containers.');
const stageCardRenderer = app.match(/function workbookStageChoiceHtml[\s\S]*?function workbookStageChoicesHtml/)?.[0] || '';
assert.doesNotMatch(stageCardRenderer, /→/, 'Cards remain directly tappable without spending width on a redundant entry arrow.');
assert.doesNotMatch(app, /<p>\$\{esc\(group\.description\)\}<\/p>/, 'Category descriptions must not add small explanatory copy beneath the category title.');
assert.doesNotMatch(app, /학습할 항목을 선택하세요/, 'The picker header must not add a second explanatory sentence.');
assert.match(css, /#student-workbook:not\(\[hidden\]\)\{touch-action:auto\}/, 'Picker must not inherit a pan-y-only gesture policy.');
assert.match(css, /\.workbook-stage-rail\{display:flex;width:100%;[^}]*overflow-x:auto[^}]*scroll-snap-type:x proximity[^}]*overscroll-behavior-x:contain[^}]*touch-action:pan-x pan-y/, 'Mobile category rail must be its own native horizontal scroller within the category card.');
assert.doesNotMatch(css, /\.workbook-stage-rail\{display:flex;width:calc\(100% \+ 32px\);[^}]*margin-right:-32px/, 'Mobile category rails must not extend beyond their category card.');
assert.match(css, /\.workbook-stage-option\{[\s\S]*?min-height:118px[\s\S]*?padding:12px 14px/, 'Desktop category cards must stay compact after the supporting copy is removed.');
assert.match(css, /\.workbook-stage-option\{width:auto;min-height:112px;grid-template-columns:42px minmax\(0,1fr\);grid-template-rows:auto auto 1fr auto;gap:6px 10px;padding:10px 12px;flex:0 0 71vw/, 'Mobile cards must use viewport-aware widths while retaining a compact partial-next-card affordance.');
assert.match(css, /@media\(max-width:380px\)\{\.workbook-stage-option\{flex-basis:73vw\}\}/, '375px cards must retain the requested 70–76% viewport width.');
assert.match(css, /@media\(max-width:340px\)\{\.workbook-stage-option\{flex-basis:80vw\}\}/, '320px cards must retain the requested 78–82% viewport width.');
assert.match(css, /@media\(max-width:900px\) and \(min-width:701px\)\{\.workbook-stage-rail\{grid-template-columns:repeat\(var\(--workbook-stage-columns-compact\)/, 'Narrow desktop may compact to two columns before mobile switches to a rail.');
assert.match(harness, /groupWorkbookStages\(stages\)/, 'Visual QA harness must exercise the same category grouping.');
assert.doesNotMatch(harness, /지문의 내용을 정확히 이해하고 기본기를 다져요/, 'Visual QA harness must not reintroduce hidden category copy.');

console.log('READY Workbook picker grouping keeps all existing stages visible.');
