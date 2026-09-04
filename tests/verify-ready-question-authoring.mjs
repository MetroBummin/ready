import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_REFERENCE_VARIANT_V2, questionAuthoringBatchErrors, questionAuthoringQualityErrors } from '../server/ready/question-authoring-quality.mjs';
import { questionVisibleInScope } from '../server/ready/question-difficulty.mjs';
import { CANONICAL_PASSAGE, DESIGN_PASSAGE, INTRO_PASSAGE, QUESTION_AUTHORING_GOLDEN, REF_3_SPANS } from './fixtures/question-authoring-ref-3-10.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const student=readFileSync(resolve(root,'ready/app.js'),'utf8');
const edge=readFileSync(resolve(root,'server/ready/index.ts'),'utf8');
const docs=readFileSync(resolve(root,'ready/QUESTION_AUTHORING.md'),'utf8');

function objective(overrides={}){
  const setText='Changes in visual designs can markedly affect behaviors of people, especially on streets.';
  return {id:'valid',type:'multiple_choice',payload:{prompt:'윗글의 요지로 가장 적절한 것은?',set_text:setText,choices:['시각 설계는 행동에 영향을 줄 수 있다.','시각 설계는 행동과 무관하다.'],answer:[0],explanation:'`Changes in visual designs can markedly affect behaviors`가 시각 설계와 행동 변화의 직접 관계를 밝히므로 첫째 선택지만 근거와 일치한다.',spec:{passage:{source:'canonical'}},authoring:{method:AI_REFERENCE_VARIANT_V2,referenceQuestionNo:10,variant:'easy',authoringContractVersion:2,difficultyRubricVersion:2,learningTarget:'visual design and behavior',goldAnswerConcept:'visual road design changes behavior',requiredEvidence:['Changes in visual designs can markedly affect behaviors'],transformation:'none',variantPurpose:'direct Korean main-idea recognition',burdenDimensions:['choice_language'],choiceVerdicts:['correct','incorrect'],explanationAnchors:['Changes in visual designs can markedly affect behaviors']},...overrides}};
}

assert.equal(QUESTION_AUTHORING_GOLDEN.length,8);
assert.deepEqual(QUESTION_AUTHORING_GOLDEN.map(item=>item.referenceQuestionNo),[3,4,5,6,7,8,9,10]);
assert.deepEqual(questionAuthoringQualityErrors({payload:objective().payload,type:'multiple_choice',canonicalPassage:CANONICAL_PASSAGE}),[],'Easy Korean-choice variant should pass');

const rewritten=objective({set_text:'Visual design often changes how people act.'});
assert(questionAuthoringQualityErrors({payload:rewritten.payload,type:rewritten.type,canonicalPassage:CANONICAL_PASSAGE}).some(error=>error.includes('exact canonical span')),'Canonical rewrite must be rejected');

const structural=objective({
  prompt:'세 부분의 순서로 가장 적절한 것은?',set_text:`(A) ${REF_3_SPANS.A} (B) ${REF_3_SPANS.B} (C) ${REF_3_SPANS.C}`,choices:['(A)-(C)-(B)','(C)-(A)-(B)'],answer:[0],
  explanation:'`These devices`는 앞의 smartphone을 받는 (A)를 먼저 요구하고, `this is an example of a nudge` 뒤에 정의 (C)가 온다. `Here are some ways`로 사례를 예고하는 (B)가 마지막이다.',
  authoring:{...objective().payload.authoring,referenceQuestionNo:3,variant:'standard',learningTarget:'canonical paragraph order',goldAnswerConcept:'A-C-B',requiredEvidence:['These devices','this is an example of a nudge','Here are some ways'],transformation:'structural_reorder',sourceSpans:[REF_3_SPANS.A,REF_3_SPANS.B,REF_3_SPANS.C],variantPurpose:'order all three source spans',burdenDimensions:['reasoning_range'],choiceVerdicts:['correct','incorrect'],explanationAnchors:['These devices','this is an example of a nudge','Here are some ways']},
});
assert.deepEqual(questionAuthoringQualityErrors({payload:structural.payload,type:structural.type,canonicalPassage:CANONICAL_PASSAGE}),[],'Structural source spans should be preserved');

const canonicalGrammar='You have probably received a notification from your smartphone telling you that it is time to exercise or move.';
const grammar=objective({
  set_text:canonicalGrammar.replace('telling','tells'),prompt:'tells를 바르게 고친 것은?',choices:['telling','told','to tell'],answer:[0],
  explanation:'`a notification from your smartphone telling you`에서 `telling`은 notification을 뒤에서 꾸미는 현재분사이므로 정동사 `tells`를 쓸 수 없다.',
  authoring:{...objective().payload.authoring,referenceQuestionNo:4,variant:'standard',learningTarget:'present participle modifier',goldAnswerConcept:'telling and banning',requiredEvidence:['a notification from your smartphone telling you'],transformation:'grammar_mutation',canonicalRange:canonicalGrammar,mutations:[{canonical:'telling',question:'tells'}],variantPurpose:'correct one canonical mutation',burdenDimensions:['target_count'],choiceVerdicts:['correct','incorrect','incorrect'],explanationAnchors:['a notification from your smartphone telling you']},
});
assert.deepEqual(questionAuthoringQualityErrors({payload:grammar.payload,type:grammar.type,canonicalPassage:CANONICAL_PASSAGE}),[],'Grammar mutation must round-trip to canonical');

const standard=objective({authoring:{...objective().payload.authoring,variant:'standard',variantPurpose:'English choices with nearby distractors',burdenDimensions:['choice_language','distractor_discrimination']}});
const hard=objective({choices:['Visual changes can influence behavior.','Visual changes alone explain every crash reduction.'],authoring:{...objective().payload.authoring,variant:'hard',variantPurpose:'separate overall claim from an overgeneralized partial claim',burdenDimensions:['distractor_discrimination','reasoning_range'],choiceVerdicts:['correct','incorrect']}});
assert.deepEqual(questionAuthoringQualityErrors({payload:standard.payload,type:standard.type,canonicalPassage:CANONICAL_PASSAGE}),[],'Standard variant should pass');
assert.deepEqual(questionAuthoringQualityErrors({payload:hard.payload,type:hard.type,canonicalPassage:CANONICAL_PASSAGE}),[],'Hard variant should pass');

const duplicateA=objective({id:'a'}),duplicateB=objective({id:'b',authoring:{...objective().payload.authoring,variant:'standard'}});
assert(questionAuthoringBatchErrors([duplicateA,duplicateB],CANONICAL_PASSAGE).some(error=>error.includes('duplicate learning value')||error.includes('duplicate question contract')),'Duplicate E/S/H variants must be rejected');

const ambiguous=objective({authoring:{...objective().payload.authoring,choiceVerdicts:['correct','correct']}});
assert(questionAuthoringQualityErrors({payload:ambiguous.payload,type:ambiguous.type,canonicalPassage:CANONICAL_PASSAGE}).some(error=>error.includes('one answer set')),'Ambiguous choice evidence must be rejected');

const generic=objective({explanation:'문맥상 적절하다.'});
assert(questionAuthoringQualityErrors({payload:generic.payload,type:generic.type,canonicalPassage:CANONICAL_PASSAGE}).some(error=>error.includes('generic')||error.includes('anchor')),'Generic explanations must be rejected');

const v2={payload:{authoring:{method:AI_REFERENCE_VARIANT_V2}}};
assert.equal(questionVisibleInScope(v2,{school:'test2',grade:'2학년'}),true);
assert.equal(questionVisibleInScope(v2,{school:'test',grade:'1학년'}),false);
assert.equal(questionVisibleInScope(v2,{school:'한빛고',grade:'2학년'}),false);
assert.match(student,/referenceQuestionNo[\s\S]*questionDifficulty/,'QA Ref badge copy is missing');
assert.match(edge,/questionVisibleInScope/,'Question access paths must keep the scope gate');
assert.match(edge,/ready_attempts[\s\S]*ready_question_bookmarks/,'Existing attempt and bookmark paths must remain explicit');
assert.match(docs,/Canonical passage is immutable[\s\S]*Generate Questions, not replacement passages/,'Authoring contract must lead with immutable canonical rules');
assert.ok(DESIGN_PASSAGE.includes('36% reduction in crashes'));

console.log('READY Question authoring v2 quality gate verified.');
