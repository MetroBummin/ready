import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_REFERENCE_BANK,referenceBankBatchErrors,referenceBankManifestErrors,referenceBankQuestionErrors } from '../server/ready/question-reference-bank.mjs';
import { questionVisibleInScope } from '../server/ready/question-difficulty.mjs';
import { INTRO_PASSAGE } from './fixtures/question-authoring-ref-3-10.mjs';
import { BANK_CANONICAL_PASSAGE,QUESTION_REFERENCE_MANIFEST,REFERENCE_FILES } from './fixtures/question-reference-bank.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const student=readFileSync(resolve(root,'ready/app.js'),'utf8');
const edge=readFileSync(resolve(root,'server/ready/index.ts'),'utf8');
const authoringDocs=readFileSync(resolve(root,'ready/QUESTION_AUTHORING.md'),'utf8');
const typeDocs=readFileSync(resolve(root,'ready/QUESTION_TYPES.md'),'utf8');

assert.deepEqual(referenceBankManifestErrors(QUESTION_REFERENCE_MANIFEST),[]);
assert.equal(REFERENCE_FILES.reduce((sum,file)=>sum+file.questionCount,0),80);
assert.equal(QUESTION_REFERENCE_MANIFEST.filter(row=>row.contentReference).length,56);
assert.equal(QUESTION_REFERENCE_MANIFEST.filter(row=>!row.contentReference).length,24);
assert.deepEqual([1,2,3,4].map(round=>QUESTION_REFERENCE_MANIFEST.filter(row=>row.round===round&&row.contentReference).length),[16,14,13,13]);
assert.deepEqual(QUESTION_REFERENCE_MANIFEST.filter(row=>row.contentReference).reduce((counts,row)=>(counts[row.sourcePassage]=(counts[row.sourcePassage]||0)+1,counts),{}),{intro:10,defaults:13,designs:15,peer_pressure:18});

function objective(overrides={}){
  return {id:'bank-valid',type:'multiple_choice',status:'available',difficulty:1,payload:{
    prompt:'윗글에서 확인할 수 없는 것은?',set_text:INTRO_PASSAGE,
    choices:['너지는 선택지를 금지하지 않는다.','행동 변화에 걸리는 정확한 시간은 제시된다.'],answer:[1],
    explanation:'`without forbidding any options`는 선택지를 금지하지 않는다고 밝히지만, 행동 변화에 걸리는 정확한 시간은 본문 어디에도 제시되지 않는다.',
    spec:{passage:{source:'canonical'}},
    authoring:{method:AI_REFERENCE_BANK,referenceBank:'cheonjae-kang-l2-exam4you-r1-r4',supportingReferences:['r1-q5','r4-q4'],difficulty:1,contractVersion:1,independentPromptCount:1,learningTarget:'distinguish stated facts from absent information',answerConcept:'the exact behavior-change time is absent',requiredEvidence:['without forbidding any options'],transformation:'none',burdenDimensions:['choice_language'],choiceVerdicts:['incorrect','correct'],explanationAnchors:['without forbidding any options']},
    ...overrides,
  }};
}

const options={canonicalPassage:BANK_CANONICAL_PASSAGE,manifest:QUESTION_REFERENCE_MANIFEST};
assert.deepEqual(referenceBankQuestionErrors(objective(),options),[]);

const leaked=objective({authoring:{...objective().payload.authoring,supportingReferences:['r3-q5']}});
assert(referenceBankQuestionErrors(leaked,options).some(error=>error.includes('non-overlap reference')),'Style references must not provide content truth');

const rewritten=objective({set_text:'A nudge gently helps people make better choices.'});
assert(referenceBankQuestionErrors(rewritten,options).some(error=>error.includes('exact canonical span')),'Canonical rewrites must be rejected');

const grammarCanonical='You have probably received a notification from your smartphone telling you that it is time to exercise or move.';
const grammar=objective({set_text:grammarCanonical.replace('telling','tells'),authoring:{...objective().payload.authoring,supportingReferences:['r1-q4','r3-q3'],difficulty:1,learningTarget:'restore a participle modifier',answerConcept:'telling',requiredEvidence:['a notification from your smartphone telling you'],transformation:'grammar_mutation',canonicalRange:grammarCanonical,mutations:[{canonical:'telling',question:'tells'}],explanationAnchors:['a notification from your smartphone telling you']},explanation:'`a notification from your smartphone telling you`에서 notification을 꾸미는 현재분사 `telling`이 필요하므로 정동사 tells를 사용할 수 없다.'});
assert.deepEqual(referenceBankQuestionErrors(grammar,options),[],'Grammar mutation must round-trip');

const ambiguous=objective({authoring:{...objective().payload.authoring,choiceVerdicts:['correct','correct']}});
assert(referenceBankQuestionErrors(ambiguous,options).some(error=>error.includes('answer set')),'Ambiguous answer sets must be rejected');

const generic=objective({explanation:'문맥상 적절하다.'});
assert(referenceBankQuestionErrors(generic,options).some(error=>error.includes('generic')),'Generic explanations must be rejected');

const nonAtomic=objective({authoring:{...objective().payload.authoring,independentPromptCount:2}});
assert(referenceBankQuestionErrors(nonAtomic,options).some(error=>error.includes('one independently answerable question')),'A card cannot combine independent prompts');

const hardByWording={...objective({authoring:{...objective().payload.authoring,difficulty:3,burdenDimensions:['choice_language']}}),difficulty:3};
assert(referenceBankQuestionErrors(hardByWording,options).some(error=>error.includes('Hard')),'Hard cannot be vocabulary only');

assert(referenceBankBatchErrors([objective(),{...objective(),id:'duplicate'}],options).some(error=>error.includes('duplicate')),'Duplicate new Questions must be rejected');

const bankRow={payload:{authoring:{method:AI_REFERENCE_BANK}}};
assert.equal(questionVisibleInScope(bankRow,{school:'test2',grade:'2학년'}),true);
assert.equal(questionVisibleInScope(bankRow,{school:'test',grade:'1학년'}),false);
assert.equal(questionVisibleInScope(bankRow,{school:'한빛고',grade:'2학년'}),false);
assert.match(edge,/supportingReferences:[\s\S]*showReference/,'Reference provenance must be QA-gated in the public contract');
assert.doesNotMatch(student,/question-reference-details|Refs \$\{refs\.length\}개/,'Student Question must not expose QA provenance');
assert.match(authoringDocs,/Reference questions are examples, not templates[\s\S]*Content Reference[\s\S]*Style Reference/);
assert.match(typeDocs,/1 READY card = 1 independently answerable Question/);

console.log('READY Reference Bank and atomic Question contract verified.');
