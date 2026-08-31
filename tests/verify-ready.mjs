import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bearerToken, randomSessionToken, secureEqual, sha256Hex, validPin } from '../server/ready/auth-core.mjs';
import { deterministicGrade, interactionContractErrors, publisherRoundTripErrors } from '../server/ready/interaction-contract.mjs';
import { validateQuestionSpec } from '../server/ready/question-spec.mjs';
import { compileAndValidateInteraction, compileInteractionContract } from '../tools/ready-interaction-contract.mjs';
import { contractChoiceCopyHtml, contractPassageHtml, contractRenderCounts, contractResponseComplete } from '../ready/interaction-runtime.js';

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
assert.match(app,/response\.layout==='sentence_cloze'[\s\S]*cloze-sentence/,'Partial guided writing must render its explicit cloze contract');
assert.match(app,/workbook-choice-or[\s\S]*또는/,'Workbook grammar choices must render as an explicit either-or control');
assert.doesNotMatch(app,/workbookChoiceHtml[^\n]*join\('<i>\/<\/i>'\)/,'Workbook grammar choices must not fall back to slash-separated text');
assert.match(edge,/publicInteractionContract[\s\S]*deterministicGrade/);
assert.match(edge,/semantic reference[\s\S]*faithful synonyms and paraphrases/,'AI grading must treat publisher answers as semantic truth, not exact copy');
assert.match(edge,/같은 원인·사실을 나타내는 자연스러운 동의어와 바꿔쓰기를 정답으로 인정/);
assert.match(runtime,/data-contract-device[\s\S]*choice_matrix/);
assert.doesNotMatch(css,/question-choice\.eliminated[^}]*text-decoration\s*:\s*line-through/,'Eliminated choices should remain readable');
assert.match(css,/\.choice-cell[\s\S]*grid-template-columns/,'Choice matrices must have an explicit visual grid');

const baseline=read('supabase/migrations/20260826150000_ready_current_baseline.sql');
const questionMigration=read('supabase/migrations/20260828150000_ready_question_first.sql');
assert.match(baseline,/ready_attempts_are_immutable[\s\S]*before update or delete/);
assert.match(questionMigration,/ready_import_question_bundle[\s\S]*jsonb_array_elements/);

const {NE_MINBYEONGCHEON_L1_WORKBOOK}=await import('../server/ready/workbook-ne-l1.mjs');
assert.equal(NE_MINBYEONGCHEON_L1_WORKBOOK.stages.length,6);
const workbookItems=NE_MINBYEONGCHEON_L1_WORKBOOK.stages.flatMap(stage=>stage.items);
assert.equal(workbookItems.length,213);
assert.equal(new Set(workbookItems.map(item=>item.key)).size,213);

console.log('READY executable Question contract checks passed');
