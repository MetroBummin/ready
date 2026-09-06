import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractUnicodePdfText } from '../server/ready/pdf-text-extract.mjs';
import { alignPublisherBlankPrompt, generateWorkbookCatalog, inspectFullWorkbookText } from '../server/ready/workbook-factory.mjs';
import { publisherAnnotations } from '../server/ready/studio-authoring.mjs';

const source = readFileSync(new URL('../ready/workbooks/ne-minbyeongcheon-lesson-1.pdf', import.meta.url)).toString('base64');
const text = await extractUnicodePdfText(source);

assert.match(text, /A missing hiker named Rene Compean was found safe on/);
assert.match(text, /Rene Compean이라는 실종된 등산객/);
assert.match(text, /^\[PAGE 1\]/, 'PDF extraction must preserve page provenance.');
assert.doesNotMatch(text, /3_100|ToUnicode/, 'Extracted text must not expose parser internals.');
assert.ok((text.match(/[가-힣]/g) || []).length > 1_000, 'Korean text layer should be decoded');
assert.doesNotMatch(text, /ëzd|Ã.|ÿ/, 'CID glyph bytes must not reach the review UI');
assert.equal(
  alignPublisherBlankPrompt('They asked him to __________ and then __________.', ['move', 'move'], 'They asked him to move and then move.'),
  'They asked him to ______________ and then ______________.',
  'Publisher blank geometry, not first matching answer text, must decide repeated-answer slot boundaries.',
);
const audit = inspectFullWorkbookText(text);
assert.equal(audit.fullWorkbook, true, 'The real publisher workbook must be recognized as a full workbook source.');
assert.equal(audit.reviewRequired, false, 'A real workbook with exact Stage 5-7 answer-key round trips may proceed without artificial Sentence Review.');
assert.equal(audit.rows.length, 41, 'The publisher Stage 2/3 source must produce 41 exact bilingual canonical rows.');
assert.doesNotMatch(audit.rows[39].translation, /가\s+져오라고/, 'PDF physical wrapping must not create a fake Korean word boundary in sentence 40.');
assert.match(audit.rows[39].translation, /가져오라고/, 'Sentence 40 must preserve the publisher Korean word spacing.');
assert.equal(audit.exercises.filter(item => item.type === 'korean_blank' && item.provenance?.origin === 'publisher_answer_key').length, 41, 'Stage 2 source and answer key must prefill every Korean blank row.');
assert.equal(audit.exercises.filter(item => item.type === 'english_blank' && item.provenance?.origin === 'publisher_answer_key').length, 41, 'Stage 3 source and answer key must prefill every English blank row.');
assert.equal(audit.exercises.filter(item => item.type === 'verb_form' && item.provenance?.origin === 'publisher_answer_key').length, 41, 'Stage 5 must be linked to all publisher answer-key rows.');
assert.equal(audit.exercises.filter(item => item.type === 'grammar_vocab_choice' && item.provenance?.origin === 'publisher_answer_key').length, 41, 'Stage 6 must be linked to all publisher answer-key rows.');
assert.equal(audit.exercises.filter(item => item.type === 'error_correction').length, 0, 'Legacy correction must not enter the semantic source set.');
assert.deepEqual(audit.incompleteStages, []);
const studioRows=audit.rows.map((row,index)=>({...row,id:`publisher-${index+1}`,blockType:'SENTENCE'}));
const annotations=publisherAnnotations(studioRows,audit.exercises,{documentName:'NE lesson 1'});
for(const semanticType of ['korean_blank','english_blank','verb_form','grammar_choice']){
  assert.equal(studioRows.filter(row=>annotations[row.id].steps[semanticType].source==='publisher').length,41,`${semanticType} must open as a Publisher review candidate without Gemini.`);
}
const catalog = generateWorkbookCatalog({ title: 'Real PDF audit', workbookKey: 'real-pdf-audit', rows: audit.rows, sourceExercises: audit.exercises });
assert.deepEqual(catalog.stages.map(stage=>stage.stage),[1,2,3,4,5,6,7]);
assert.equal(catalog.stages.find(entry => entry.stage === 4).items.length,41);
assert.equal(catalog.stages.find(entry => entry.stage === 5).items.length,41);
assert.equal(catalog.stages.find(entry => entry.stage === 7).items.length,0,'A writing section without an unambiguous one-sentence canonical link stays private.');
assert.ok(catalog.metrics.unresolved>0,'Unresolved semantic source must block publication instead of being synthesized.');
assert.equal(catalog.metrics.geminiCallCount,0);
assert.equal(catalog.metrics.validatorDrop, 0, 'Punctuation must not cause deterministic exercise drops.');

console.log('READY PDF Unicode extraction checks passed.');
