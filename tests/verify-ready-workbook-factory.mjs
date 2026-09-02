import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSentenceRows, generateWorkbookCatalog, inspectFullWorkbookText, semanticWorkbookType } from '../server/ready/workbook-factory.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=name=>readFileSync(resolve(root,'tests/fixtures',name),'utf8');
const canonical=[{text:'Humans excel at visual imagery.',translation:'인간은 시각적 심상에 뛰어나다.'},{text:'Our brains evolved this ability for survival.',translation:'우리의 뇌는 생존을 위해 이 능력을 발달시켰다.'}];

// Case A: semantic headings win over publisher stage numbers, and Check is excluded.
const textbook=inspectFullWorkbookText(fixture('workbook-factory-textbook.txt'));
assert.equal(textbook.fullWorkbook,true);
assert.equal(textbook.reviewRequired,false);
assert.ok(textbook.headings.some(item=>item.type==='writing'));
assert.equal(semanticWorkbookType('Stage 10 Check'),'check_mixed');

// Case B: paragraph ordering is never mapped to READY Stage 8; writing still is.
const mock=inspectFullWorkbookText(fixture('workbook-factory-mock.txt'));
assert.equal(mock.fullWorkbook,true);
assert.equal(semanticWorkbookType('Paragraph ordering'),'paragraph_ordering');
assert.equal(semanticWorkbookType('Writing'),'writing');

// Case C: passage-only starts with reviewable rows; edits, deletion, insertion and
// re-numbering are all represented by the final row order passed to generation.
const only=extractSentenceRows('Humans excel at visual imagery.\nOur brains evolved this ability for survival.');
assert.equal(only.needsTranslation,true);
const pdfNoise=extractSentenceRows('Humans excel at visual imagery.\u0000\nOur brains evolved this ability for survival.');
assert.ok(pdfNoise.rows.every(row=>!JSON.stringify(row).includes('\\u0000')),'PDF control characters must not reach JSONB storage.');
const reviewed=[{text:'Humans excel at visual imagery.',translation:'인간은 시각적 심상에 뛰어나다.'},{text:'They improve when they reflect on feedback.',translation:'그들은 피드백을 돌아볼 때 향상된다.'},canonical[1]];
const catalog=generateWorkbookCatalog({title:'Golden',workbookKey:'golden',rows:reviewed,ai:{5:[{sentenceIndex:1,prompt:'Humans excel at visual ____________.',hint:'image',answer:'imagery'}],6:[{sentenceIndex:2,prompt:'They improve when they reflect on ____________.',wrong:'feedforward',answer:'feedback'}],7:[{sentenceIndex:3,sentence:'Our brains evolve this ability for survival.',wrong:'evolve',correct:'evolved'}]}});
assert.deepEqual(catalog.stages.map(stage=>stage.stage),[2,3,4,5,6,7,8,9]);
assert.equal(catalog.stages.find(stage=>stage.stage===2).items[0].number,1);
assert.equal(catalog.stages.find(stage=>stage.stage===9).items.length,3);
assert.equal(catalog.stages.find(stage=>stage.stage===5).items.length,1);
assert.equal(catalog.stages.find(stage=>stage.stage===6).items.length,1);
assert.equal(catalog.stages.find(stage=>stage.stage===7).items.length,1);
assert.equal(catalog.metrics.validatorDrop,0);

const fullReuse=generateWorkbookCatalog({title:'Publisher',workbookKey:'publisher',rows:canonical,sourceExercises:[
  {type:'verb_form',number:1,prompt:'Humans excel at visual ____________.',answer:'imagery',provenance:{page:3}},
  {type:'verb_form',number:2,prompt:'Our brains ____________ this ability for survival.',answer:'evolved',provenance:{page:3}},
  {type:'grammar_vocab_choice',number:1,prompt:'Humans (excel/excels) at visual imagery.',answer:'excel',provenance:{page:4}},
  {type:'grammar_vocab_choice',number:2,prompt:'Our brains (evolve/evolved) this ability for survival.',answer:'evolved',provenance:{page:4}},
  {type:'error_correction',number:1,prompt:'Humans excels at visual imagery.',answer:'excels → excel',provenance:{page:5}},
  {type:'error_correction',number:2,prompt:'Our brains evolve this ability for survival.',answer:'evolve → evolved',provenance:{page:5}},
],provenance:{geminiCallCount:0}});
assert.equal(fullReuse.metrics.geminiCallCount,0,'Full Workbook source reuse must not call Gemini');
assert.deepEqual([5,6,7].map(stage=>fullReuse.stages.find(item=>item.stage===stage).items.length),[2,2,2]);
assert.equal(fullReuse.metrics.validatorDrop,0);

const invalid=generateWorkbookCatalog({title:'Invalid',workbookKey:'invalid',rows:canonical,ai:{5:[{sentenceIndex:1,prompt:'Invented sentence ____________.',hint:'invent',answer:'invented'}]}});
assert.equal(invalid.stages.find(stage=>stage.stage===5).items.length,0);
assert.equal(invalid.metrics.dropReasons.stage5_round_trip,1);
console.log('READY Workbook Factory golden paths verified.');
