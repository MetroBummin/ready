import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractUnicodePdfText } from '../server/ready/pdf-text-extract.mjs';
import { generateWorkbookCatalog, inspectFullWorkbookText } from '../server/ready/workbook-factory.mjs';

const source = readFileSync(new URL('../ready/workbooks/ne-minbyeongcheon-lesson-1.pdf', import.meta.url)).toString('base64');
const text = await extractUnicodePdfText(source);

assert.match(text, /A missing hiker named Rene Compean was found safe on/);
assert.match(text, /Rene Compean이라는 실종된 등산객/);
assert.match(text, /^\[PAGE 1\]/, 'PDF extraction must preserve page provenance.');
assert.doesNotMatch(text, /3_100|ToUnicode/, 'Extracted text must not expose parser internals.');
assert.ok((text.match(/[가-힣]/g) || []).length > 1_000, 'Korean text layer should be decoded');
assert.doesNotMatch(text, /ëzd|Ã.|ÿ/, 'CID glyph bytes must not reach the review UI');
const audit = inspectFullWorkbookText(text);
assert.equal(audit.fullWorkbook, true, 'The real publisher workbook must be recognized as a full workbook source.');
assert.equal(audit.reviewRequired, true, 'A real workbook with incomplete answer linkage must stop at Sentence Review instead of auto-publishing partial content.');
assert.equal(audit.rows.length, 41, 'The publisher Stage 2/3 source must produce 41 exact bilingual canonical rows.');
assert.equal(audit.exercises.filter(item => item.type === 'verb_form' && item.provenance?.origin === 'publisher_answer_key').length, 41, 'Stage 5 must be linked to all publisher answer-key rows.');
assert.equal(audit.exercises.filter(item => item.type === 'grammar_vocab_choice' && item.provenance?.origin === 'publisher_answer_key').length, 41, 'Stage 6 must be linked to all publisher answer-key rows.');
assert.deepEqual(audit.incompleteStages, [7]);
const catalog = generateWorkbookCatalog({ title: 'Real PDF audit', workbookKey: 'real-pdf-audit', rows: audit.rows, sourceExercises: audit.exercises });
for (const stage of [2, 3, 4, 5, 6, 8, 9]) assert.equal(catalog.stages.find(entry => entry.stage === stage).items.length, 41, `Stage ${stage} must retain every canonical sentence.`);
assert.equal(catalog.stages.find(entry => entry.stage === 7).items.length, 0, 'Unsupported Stage 7 source must remain private until structured.');
assert.equal(catalog.metrics.validatorDrop, 0, 'Punctuation must not cause deterministic exercise drops.');

console.log('READY PDF Unicode extraction checks passed.');
