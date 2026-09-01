import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bearerToken, randomSessionToken, secureEqual, sha256Hex, validPin } from '../server/ready/auth-core.mjs';
import { deterministicGrade, interactionContractErrors, publisherRoundTripErrors } from '../server/ready/interaction-contract.mjs';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';
import { compileAndValidateInteraction, compileInteractionContract } from '../tools/ready-interaction-contract.mjs';
import { contractChoiceCopyHtml, contractPassageHtml, contractRenderCounts, contractResponseComplete } from '../ready/interaction-runtime.js';
import { WORKBOOK_TRANSLATION_GRADING_POLICY, workbookTranslationPass } from '../server/ready/workbook-grading-policy.mjs';
import { normalizeWorkbookAnswer as normalizeWorkbookAnswerClient, livePrefixState, verifierMatches, workbookRecallCue as workbookRecallCueClient } from '../ready/workbook-assistance.js';
import { normalizeWorkbookAnswer as normalizeWorkbookAnswerServer, publicWorkbookAssistance, stageNineHint, workbookRecallCue as workbookRecallCueServer } from '../server/ready/workbook-assistance.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]));

assert.equal(validPin('1234'),true);
assert.equal(validPin('123456'),true);
assert.equal(validPin('123'),false);
const token=randomSessionToken();
assert.match(token,/^[A-Za-z0-9_-]{43}$/);
assert.equal(bearerToken(`Bearer ${token}`),token);
assert.equal((await sha256Hex(token)).length,64);
assert.equal(secureEqual('same-secret','same-secret'),true);
assert.equal(normalizeWorkbookAnswerClient(' While  scrolling! '),'while scrolling');
assert.equal(normalizeWorkbookAnswerClient(' While  scrolling! '),normalizeWorkbookAnswerServer(' While  scrolling! '),'Stage 9 live and final grading normalization must stay aligned');
assert.equal(workbookRecallCueClient('퍼지고 있다','korean_syllable'),'퍼');
assert.equal(workbookRecallCueServer('퍼지고 있다','korean_syllable'),'퍼');
assert.equal(workbookRecallCueClient('turned out','english_initial'),'t');
const recallContract=await publicWorkbookAssistance({stage:2,answers:['퍼지고 있다']},sha256Hex);
assert.equal(recallContract.mode,'recall_unlock');
assert.equal(await verifierMatches('퍼',recallContract.slots[0]),true);
assert.equal(await verifierMatches('파',recallContract.slots[0]),false);
assert.equal(JSON.stringify(recallContract).includes('퍼지고 있다'),false,'Recall contract must not expose the answer');
const prefixContract=await publicWorkbookAssistance({stage:9,answers:['While scrolling']},sha256Hex);
assert.deepEqual(await livePrefixState('While scrol',prefixContract.slots[0]),{valid:true,mismatchIndex:-1,complete:false});
assert.deepEqual(await livePrefixState('While scrolx',prefixContract.slots[0]),{valid:false,mismatchIndex:11,complete:false});
assert.equal((await livePrefixState('While scrolling',prefixContract.slots[0])).complete,true);
assert.equal(JSON.stringify(prefixContract).includes('while scrolling'),false,'Prefix contract must not expose the answer');
assert.equal(stageNineHint('provocative false stories',1),'provocative');
assert.equal(stageNineHint('provocative false stories',2),'provocative false stories');
assert.equal(stageNineHint('provocative',1),'p');

function objective(overrides={}){
  const payload={
    prompt:'윗글의 빈칸 (A), (B)에 들어갈 말로 알맞게 연결된 것은?',
    set_text:'The system was (A)__________ and the field kept (B)__________.',
    taxonomy:'blank_phrase',
    choices:['investigated developing','tested growing','ignored shrinking'],
    choice_parts:[['investigated','developing'],['tested','growing'],['ignored','shrinking']],
    answer:[0],multi_select:false,explanation:'PDF 해설',import_status:'ready',
    spec:{renderer:'structural',passage:{source:'canonical',annotations:[]},extras:[],choiceMode:'single',responseMode:'choice',gradingMode:'exact'},
    ...overrides,
  };
  compileInteractionContract(payload,'multiple_choice');
  return payload;
}

const matrix=objective();
assert.deepEqual(compileAndValidateInteraction(matrix,'multiple_choice'),[]);
assert.equal(validateQuestionSpec(matrix,'multiple_choice','available').ready,true);
assert.equal(matrix.spec.interaction.kind,'choice_matrix');
assert.deepEqual(matrix.spec.interaction.choices.columns,['(A)','(B)']);
assert.deepEqual(matrix.spec.interaction.choices.rows[0].cells,['investigated','developing']);
assert.deepEqual(contractRenderCounts(matrix.spec.interaction),{passageDevices:2,choiceRows:3,choiceCells:6,responseSlots:0});
assert.equal((contractPassageHtml(matrix.spec.interaction,{escape}).match(/data-contract-device=/g)||[]).length,2);
assert.match(contractChoiceCopyHtml(matrix.spec.interaction,0,escape),/data-choice-column="0"[\s\S]*investigated[\s\S]*data-choice-column="1"[\s\S]*developing/);
assert.deepEqual(deterministicGrade(matrix,'multiple_choice',{selected:[0]}),{valid:true,correct:true,answer:[0]});
assert.deepEqual(publisherRoundTripErrors(matrix,'multiple_choice'),[]);

const missingCells=objective();
delete missingCells.choice_parts;
delete missingCells.spec.interaction;
assert(compileAndValidateInteraction(missingCells,'multiple_choice').some(error=>error.includes('explicit choice_parts')));

const missingBlanks=objective({set_text:'The system was investigated and the field kept developing.'});
assert(interactionContractErrors(missingBlanks,'multiple_choice').some(error=>error.includes('prompt devices do not match passage devices')));
assert.equal(validateQuestionSpec(missingBlanks,'multiple_choice','available').ready,false);

const inlinePublisher=objective({
  prompt:'(A), (B), (C)의 각 네모 안에서 어법상 알맞은 것을 고르시오.',taxonomy:'grammar_ab',
  set_text:'He was (A)[safe / safely], chose (B)[which / what], and planned (C)[to hike / hiking].',
  choices:['safe - what - hiking','safely - which - hiking','safe - which - to hike'],answer:[2],
});
assert.equal(inlinePublisher.spec.interaction.kind,'choice_list');
assert.equal(inlinePublisher.spec.interaction.passage.segments.filter(item=>item.kind==='inline_options_display').length,3);
assert.doesNotMatch(contractPassageHtml(inlinePublisher.spec.interaction,{escape}),/data-inline-option/);
assert.equal(validateQuestionSpec(inlinePublisher,'multiple_choice','available').ready,true);
const mismatchedInline=objective({prompt:'(A), (B), (C)의 각 네모 안에서 문맥에 맞는 낱말을 고르시오.',taxonomy:'vocabulary_context',set_text:'He was (A)[safe / safely], chose (B)[which / what], and planned (C)[to hike / hiking].',choices:['ⓐ','ⓑ','ⓒ','ⓓ','ⓔ'],answer:[0]});
assert.equal(validateQuestionSpec(mismatchedInline,'multiple_choice','available').ready,false);

const reference=objective({prompt:'밑줄 친 부분이 가리키는 대상이 다른 것은?',taxonomy:'reference',set_text:'One of ① his hobbies mattered. ② He agreed. ③ Him they trusted.',choices:['1','2','3'],answer:[1],target_ranges:[{label:'①',text:'his'},{label:'②',text:'He'},{label:'③',text:'Him'}],spec:{renderer:'annotated_passage_mcq',passage:{source:'canonical',annotations:[]},extras:[],choiceMode:'single',responseMode:'choice',gradingMode:'exact'}});
assert.equal(reference.spec.interaction.passage.segments.filter(item=>item.kind==='annotation').length,3);
assert.equal(validateQuestionSpec(reference,'multiple_choice','available').ready,true);

const written={
  prompt:'주어진 우리말을 조건에 맞게 영작하시오.',
  set_text:'The police decided to use social media to find clues in the picture.',
  taxonomy:'guided_writing',
  accepted_answers:[['The police decided to use social media'],['to find clues in the picture']],
  response_slots:[{label:'(1)',word_count:7},{label:'(2)',word_count:6}],
  writing_guide:{kind:'sentence',title:'영작하시오.',task_text:'그래서 그들은 사진 속에서 단서를 찾기 위해 소셜 미디어를 사용하기로 결정했습니다.',conditions:['(1)은 7단어, (2)는 6단어로 쓸 것'],word_bank:['decide','social media','find clues'],targets:[],slot_labels:['(1)','(2)']},
  ai_structure:{engine:'codex-cli',contract_version:2},
  import_status:'ready',
  spec:{renderer:'written_input',passage:{source:'canonical',annotations:[]},extras:[],choiceMode:'none',responseMode:'input',gradingMode:'accepted_variants'},
};
compileInteractionContract(written,'written_response');
assert.equal(written.spec.interaction.kind,'written_response');
assert.equal(written.spec.interaction.response.layout,'sentence_parts');
assert.equal(written.spec.interaction.passage.visible,false,'Guided writing must not leak the publisher answer as a passage');
assert.equal(contractPassageHtml(written.spec.interaction,{escape}),'');
assert.equal(contractResponseComplete(written.spec.interaction,['first','second']),true);
assert.equal(contractResponseComplete(written.spec.interaction,['first','']),false);
assert.deepEqual(publisherRoundTripErrors(written,'written_response'),[]);
assert.deepEqual(deterministicGrade(written,'written_response',{responses:['The police decided to use social media','to find clues in the picture']}),{valid:true,correct:true,answer:written.accepted_answers});

const passageAnswer=structuredClone(written);
passageAnswer.prompt='다음 본문을 읽고 영어 질문에 답하시오.';
passageAnswer.writing_guide.task_text='What caused the police to use social media?';
delete passageAnswer.spec.interaction;
compileInteractionContract(passageAnswer,'written_response');
assert.equal(passageAnswer.spec.interaction.passage.visible,true,'A passage-dependent prompt must render its approved evidence');

const guidedTarget=structuredClone(written);
guidedTarget.prompt='윗글의 우리말을 조건에 맞게 영작하시오.';
delete guidedTarget.spec.interaction;
compileInteractionContract(guidedTarget,'written_response');
assert.equal(guidedTarget.spec.interaction.passage.visible,false,'Guided writing must not reveal its publisher answer even when the prompt refers to the passage');

const staleSlots=structuredClone(written);
staleSlots.accepted_answers=[['one'],['two'],['three']];
assert(interactionContractErrors(staleSlots,'written_response').some(error=>error.includes('response slots do not match answer slots')));
assert.equal(validateQuestionSpec(staleSlots,'written_response','available').ready,false);

const app=read('ready/app.js');
const edge=read('server/ready/index.ts');
const runtime=read('ready/interaction-runtime.js');
const css=read('ready/ready.css');
for(const removed of ['inferredChoiceParts','CHOICE_PART_REPAIRS','WRITING_GUIDE_REPAIRS','SUMMARY_REPAIRS','TARGET_RANGE_REPAIRS','canonicalOption','questionBasePassage','slots.length>1']){
  assert.doesNotMatch(`${app}\n${edge}`,new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`Runtime inference remains: ${removed}`);
}
assert.match(app,/contractPassageHtml[\s\S]*contractChoiceCopyHtml[\s\S]*contractResponseComplete/);
assert.match(app,/response\.layout==='sentence_cloze'[\s\S]*cloze-frame[\s\S]*cloze-slot-list/,'Partial guided writing must separate its sentence frame from numbered inputs');
assert.match(app,/workbook-choice-or[\s\S]*또는/,'Workbook grammar choices must render as an explicit either-or control');
assert.doesNotMatch(app,/workbookChoiceHtml[^\n]*join\('<i>\/<\/i>'\)/,'Workbook grammar choices must not fall back to slash-separated text');
assert.match(edge,/publicInteractionContract[\s\S]*deterministicGrade/);
assert.match(edge,/semantic reference[\s\S]*faithful synonyms and paraphrases/,'AI grading must treat publisher answers as semantic truth, not exact copy');
assert.match(edge,/같은 원인·사실을 나타내는 자연스러운 동의어와 바꿔쓰기를 정답으로 인정/);
assert.match(app,/data-toggle-workbook-bookmark[\s\S]*data-review-workbook-passage/,'Workbook Review must reopen the original workbook renderer');
assert.match(runtime,/data-contract-device[\s\S]*choice_matrix/);
assert.doesNotMatch(css,/question-choice\.eliminated[^}]*text-decoration\s*:\s*line-through/,'Eliminated choices should remain readable');
assert.match(css,/\.choice-cell[\s\S]*grid-template-columns/,'Choice matrices must have an explicit visual grid');

const baseline=read('supabase/migrations/20260826150000_ready_current_baseline.sql');
const questionMigration=read('supabase/migrations/20260828150000_ready_question_first.sql');
const workbookReviewMigration=read('supabase/migrations/20260831233000_ready_workbook_review_ai.sql');
const workbookGradeLinkMigration=read('supabase/migrations/20260901013000_ready_workbook_ai_grade_link.sql');
const workbookAssistanceMigration=read('supabase/migrations/20260901030000_ready_workbook_assistance.sql');
assert.match(baseline,/ready_attempts_are_immutable[\s\S]*before update or delete/);
assert.match(questionMigration,/ready_import_question_bundle[\s\S]*jsonb_array_elements/);
assert.match(workbookReviewMigration,/ready_workbook_bookmarks[\s\S]*ready_workbook_ai_grading_requests/);
assert.match(workbookGradeLinkMigration,/ai_grading_request_id[\s\S]*references public\.ready_workbook_ai_grading_requests/);
assert.match(workbookGradeLinkMigration,/delete from ready_workbook_attempts[\s\S]*delete from ready_workbook_ai_grading_requests/,'Cascade must delete linked attempts before AI audit rows');
assert.match(workbookAssistanceMigration,/hint_count[\s\S]*used_full_answer_hint[\s\S]*completed_after_hint/,'Stage 9 assistance must be queryable on append-only attempts');

const {NE_MINBYEONGCHEON_L1_WORKBOOK}=await import('../server/ready/workbook-ne-l1.mjs');
const {NE_MINBYEONGCHEON_L2_WORKBOOK}=await import('../server/ready/workbook-ne-l2.mjs');
const {YBM_PARKJUNEON_L1_WORKBOOK}=await import('../server/ready/workbook-ybm-l1.mjs');
const {YBM_PARKJUNEON_L2_WORKBOOK}=await import('../server/ready/workbook-ybm-l2.mjs');
const workbooks=[NE_MINBYEONGCHEON_L1_WORKBOOK,NE_MINBYEONGCHEON_L2_WORKBOOK,YBM_PARKJUNEON_L1_WORKBOOK,YBM_PARKJUNEON_L2_WORKBOOK];
assert.deepEqual(workbooks.map(book=>book.stages.flatMap(stage=>stage.items).length),[295,364,327,394]);
for(const book of workbooks)assert.deepEqual(book.stages.map(stage=>stage.stage),[2,3,4,5,6,7,8,9],`${book.workbookKey} must expose every requested workbook stage`);
const workbookItems=workbooks.flatMap(book=>book.stages.flatMap(stage=>stage.items));
assert.equal(new Set(workbookItems.map(item=>item.key)).size,workbookItems.length);
for(const item of workbookItems){assert(item.answers.length>0);if(item.kind==='blank_input'||item.kind==='verb_form')assert.equal((item.prompt.match(/_{5,}/g)||[]).length,item.answers.length);if(item.kind==='verb_form')assert.equal(item.hints.length,item.answers.length);if(item.kind==='choice_groups')assert.equal(item.groups.length,item.answers.length);if(item.kind==='correction_pairs')assert.equal(item.pairCount*2,item.answers.length);if(item.kind==='translation_ai')assert.equal(item.answers.length,1);}
for(const book of workbooks){assert.equal(book.source.preserved,true);assert.match(book.source.sha256,/^[a-f0-9]{64}$/);for(const item of book.unpublishedExercises)assert.equal(item.status,'INVALID');}
for(const book of workbooks)assert(book.stages.find(stage=>stage.stage===2).items.every(item=>item.kind==='blank_input'),'Stage 2 must remain deterministic blank input');
const adjacentStage5=NE_MINBYEONGCHEON_L2_WORKBOOK.stages.find(stage=>stage.stage===5).items.find(item=>item.prompt.includes('The clues'));
assert.deepEqual(adjacentStage5.answers,['are used','to find','committed'],'Stage 5 must preserve publisher slash-separated slot boundaries');
const importer=read('tools/ready-extract-workbook-contract.py');
assert.match(importer,/stage5_answer_items[\s\S]*value\.split\("\/"\)/,'Stage 5 answers must come from publisher Answer Key separators');
assert.match(importer,/fill_frame\(frame, answers\)[\s\S]*canonical_corpus/,'Stage 5 publisher slots must round-trip to the canonical corpus');
assert.match(app,/placeholder="\$\{esc\(hint\|\|'\'\)\}"/,'Stage 5 base verbs must be input placeholders, not exposed labels');
assert.match(app,/workbook-order-bank-slot \$\{chosenSet\.has\(chipIndex\)\?'used'/,'Stage 8 must preserve every bank slot after selection');
assert.match(app,/changeWorkbookOrder[\s\S]*refreshWorkbookOrderGroup\(group\)/,'Stage 8 chip changes must locally refresh only their group');
assert.doesNotMatch(app,/changeWorkbookOrder[^\n]*renderWorkbook\(\)/,'Stage 8 chip changes must not rerender the full Workbook');
assert.match(read('ready/design.css'),/workbook-order-bank-slot\.used\{visibility:hidden/,'Selected Stage 8 chips must keep their original geometry');
assert.match(read('ready/design.css'),/workbook-order-built\{[^}]*min-height:68px/,'Stage 8 must keep a compact fixed assembly area');
assert.doesNotMatch(read('ready/design.css'),/--workbook-order-stable-height/,'Stage 8 must not mirror the full bank height into the assembly area');
assert.match(app,/function queueWorkbookAutoSubmit\(\)[^\n]*submitWorkbook/,'Choice and reorder tasks must auto-submit only after every slot is complete');
assert.match(app,/session\.submitting=true[^\n]*session\.submitting=false/,'Workbook submission must reject duplicate automatic requests');
assert.doesNotMatch(app,/function renderWorkbook\(\)[^\n]*stage\.instruction/,'Focused Workbook must not repeat stage instructions');
assert.doesNotMatch(app,/function renderWorkbook\(\)[^\n]*data-submit-workbook/,'Focused Workbook must not render a manual grading button');
assert.match(app,/event\.isComposing\|\|event\.keyCode===229/,'Enter grading must ignore active IME composition');
assert.match(app,/backGesture=dx<=-64\|\|\(swipe\.fromLeftEdge&&dx>=64\)/,'Workbook previous navigation must support left swipe and the iOS-style edge gesture');
assert.equal(WORKBOOK_TRANSLATION_GRADING_POLICY.passScore,75);
assert.equal(workbookTranslationPass(74,[]),false);
assert.equal(workbookTranslationPass(75,[]),true);
assert.equal(workbookTranslationPass(100,['negation_reversal']),false);
assert.match(edge,/workbookTranslationPrompt[\s\S]*핵심 의미 60점[\s\S]*핵심 관계 30점[\s\S]*자연스러운 한국어 10점/);
assert.match(edge,/정도 부사의 작은 생략[\s\S]*critical_errors[\s\S]*부정[\s\S]*인과/,'Translation rubric must cover modifier omission and critical reversals');
assert.match(edge,/workbookTranslationPass\(grade\.score,grade\.criticalErrors\)/,'READY code, not the model, must make Workbook translation pass/fail');
assert.match(edge,/callGeminiGrade\(question, spec, responses\)[\s\S]*grade\.correct/,'Question AI grading semantics must remain unchanged');
assert.match(edge,/rubricSnapshot[\s\S]*publisherReferenceTranslation[\s\S]*gradingPolicy[\s\S]*passScore/);
assert.match(edge,/ready_workbook_ai_grading_requests[\s\S]*status: "pending"[\s\S]*callGeminiTranslationGrade/,'Workbook translations must be persisted before AI inference');
assert.match(edge,/ai_grading_request_id: aiRequestId/,'Workbook attempt must link to the AI grading request');
assert.match(edge,/unlock_workbook_recall[\s\S]*workbook_hint/,'Recall unlock and staged hints must be explicit student operations');
assert.match(edge,/assistance: workbookAssistanceMode\(item\)/,'Workbook listing must expose only the assistance mode, not every answer verifier');
assert.match(edge,/async function workbookAssistance[\s\S]*publicWorkbookAssistance/,'Only the current item may lazily request its verifier contract');
assert.match(app,/ensureWorkbookAssistance[\s\S]*workbook_assistance/,'The client must cache a verifier contract per current item instead of loading the whole workbook');
assert.match(edge,/usedFullAnswerHint[\s\S]*correct = false/,'A full-answer hint must force the current Stage 9 attempt to wrong');
assert.match(edge,/형용사절·부사절·주절의 동사/,'Translation feedback must identify the misunderstood sentence unit');
assert.match(app,/compositionstart[\s\S]*compositionend[\s\S]*handleWorkbookRecallInput/,'Korean recall must wait for IME composition to finish');
assert.match(app,/flashRecallWrong[\s\S]*220/,'A wrong recall cue must clear after a brief red signal');
assert.match(app,/data-workbook-live-prefix[\s\S]*workbook-live-copy/,'Stage 9 must show live mismatch feedback without ending the attempt');
assert.match(app,/hintReceipt[\s\S]*completedAfterHint/,'Stage 9 hint state must survive through final grading');
assert.match(app,/bookmark-star[\s\S]*★[\s\S]*☆/,'Question and Workbook bookmarks must share star language');

console.log('READY executable Question contract checks passed');
