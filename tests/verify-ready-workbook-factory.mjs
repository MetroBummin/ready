import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCanonicalRows, extractSentenceRows, factoryFallbackTargets, generateWorkbookCatalog, inspectFullWorkbookText, semanticWorkbookType } from '../server/ready/workbook-factory.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=name=>readFileSync(resolve(root,'tests/fixtures',name),'utf8');
const canonical=[{text:'Humans excel at visual imagery.',translation:'인간은 시각적 심상에 뛰어나다.'},{text:'Our brains evolved this ability for survival.',translation:'우리의 뇌는 생존을 위해 이 능력을 발달시켰다.'}];
assert.equal(compareCanonicalRows(canonical,canonical).consistent,true,'Existing Passage mode must accept the unchanged canonical sentence pairs.');
assert.equal(compareCanonicalRows(canonical,[...canonical].reverse()).reason,'canonical_text_mismatch','Existing Passage mode must reject reordered PDF rows.');
assert.equal(compareCanonicalRows(canonical,canonical.slice(0,1)).reason,'sentence_count_mismatch','Existing Passage mode must reject an incomplete PDF passage.');

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
const tsv=extractSentenceRows('English\tKorean\nHumans excel at visual imagery.\t인간은 시각적 심상에 뛰어나다.\nOur brains evolved this ability for survival.\t우리의 뇌는 생존을 위해 이 능력을 발달시켰다.');
assert.equal(tsv.pairing,'tsv_two_column');
assert.equal(tsv.rows.length,2);
assert.equal(extractSentenceRows('Humans excel.\t인간은 뛰어나다.\nloose note').pairing,'invalid_mixed_tsv','Mixed TSV must fail closed rather than silently dropping a line.');
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
assert.ok(catalog.stages.find(stage=>stage.stage===8).items[0].groups[0].every(token=>!token.includes(' ')),'Factory Stage 8 must render one English word per chip.');
assert.deepEqual(catalog.metrics.stageCoverage[8],{ready:3,expected:3});

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
assert.equal(fullReuse.metrics.sourceReusedExercises,6);
assert.equal(fullReuse.metrics.geminiGeneratedExercises,0);
assert.equal(fullReuse.metrics.validatorDrop,0);

const passageCorrection=generateWorkbookCatalog({title:'Publisher passage correction',workbookKey:'publisher-passage',rows:canonical,sourceExercises:[
  {type:'error_correction',number:1,prompt:'Humans excels at visual imagery. Our brains evolve this ability for survival.',answer:'excels → excel / evolve → evolved',provenance:{page:5}},
]});
const passageCorrectionItem=passageCorrection.stages.find(stage=>stage.stage===7).items[0];
assert.equal(passageCorrectionItem.pairCount,2,'Publisher Stage 7 must preserve multiple correction pairs in one passage/range exercise.');
assert.deepEqual(passageCorrection.metrics.stageCoverage[7],{ready:1,expected:1},'Publisher passage exercises use publisher exercise count rather than sentence count.');

const partialReuse=generateWorkbookCatalog({title:'Partial',workbookKey:'partial',rows:canonical,sourceExercises:[
  {type:'verb_form',number:1,prompt:'Humans excel at visual ____________.',answer:'imagery',provenance:{page:3}},
],ai:{5:[{sentenceIndex:1,prompt:'Humans excel at visual ____________.',hint:'image',answer:'imagery'},{sentenceIndex:2,prompt:'Our brains ____________ this ability for survival.',hint:'evolve',answer:'evolved'}]},provenance:{geminiCallCount:1}});
assert.deepEqual(partialReuse.stages.find(stage=>stage.stage===5).items.map(item=>item.number),[1,2],'AI may fill only missing source items without replacing publisher exercises.');
assert.equal(partialReuse.metrics.sourceReusedExercises,1);
assert.equal(partialReuse.metrics.geminiGeneratedExercises,1);
assert.deepEqual(partialReuse.metrics.stageCoverage[5],{ready:2,expected:2},'Source and AI exercises must combine into sentence-level Stage 5 coverage.');
const partialSourceOnly=generateWorkbookCatalog({title:'Partial source only',workbookKey:'partial-source',rows:canonical,sourceExercises:[
  {type:'verb_form',number:1,prompt:'Humans excel at visual ____________.',answer:'imagery',provenance:{page:3}},
]});
assert.deepEqual(factoryFallbackTargets(partialSourceOnly,canonical,[{type:'verb_form',number:1,prompt:'x',answer:'x'}]),{5:[2],6:[1,2],7:[1,2]},'Fallback must request only missing validated sentence coverage.');

const invalid=generateWorkbookCatalog({title:'Invalid',workbookKey:'invalid',rows:canonical,ai:{5:[{sentenceIndex:1,prompt:'Invented sentence ____________.',hint:'invent',answer:'invented'}]}});
assert.equal(invalid.stages.find(stage=>stage.stage===5).items.length,0);
assert.equal(invalid.metrics.dropReasons.stage5_round_trip,1);

const normalizedAi=generateWorkbookCatalog({title:'Normalized AI',workbookKey:'normalized-ai',rows:[{text:"It's useful.",translation:'그것은 유용하다.'}],ai:{
  6:[{sentenceIndex:1,prompt:'It is ____________.',wrong:'useless',answer:'useful'}],
  7:[{sentenceIndex:1,sentence:"It's useful.",wrong:'use',correct:'useful'}],
}});
assert.equal(normalizedAi.stages.find(stage=>stage.stage===6).items.length,1,'Stage 6 may normalize harmless contraction and punctuation differences after exact answer restoration.');
assert.equal(normalizedAi.stages.find(stage=>stage.stage===7).items[0].prompt,"It's use.",'Stage 7 may construct the faulty prompt from a validated wrong/correct pair when Gemini echoes the canonical sentence.');

const edge=readFileSync(resolve(root,'server/ready/index.ts'),'utf8'),admin=readFileSync(resolve(root,'ready/admin/app.js'),'utf8'),adminHtml=readFileSync(resolve(root,'ready/admin/index.html'),'utf8');
assert.match(edge,/existingMode \? existingContext\.passage\.id : rows<string>\(await db\.rpc\("ready_create_passage_with_sentences"/,'Existing Passage finalization must reuse its passage_id instead of creating a passage.');
assert.match(edge,/codeWorkbookForPassage\(passageResult\.data\)[\s\S]*ready_workbook_catalogs[\s\S]*ready_passage_sentences/,'Existing Passage preflight must reject static/factory duplicates before loading canonical rows.');
assert.match(edge,/if \(!existingMode\) await db\.from\("ready_passages"\)\.delete/,'A failed existing catalog insert must never delete the existing passage.');
assert.match(adminHtml,/existing_passage[\s\S]*factory-existing-passage/,'Admin must expose the existing Passage mode and selector.');
assert.match(admin,/existing\?\{\}:\{sentenceRows:state\.factoryRows\}/,'Admin must not submit editable sentence rows in existing Passage mode.');
assert.match(edge,/factoryFallbackTargets\(sourcePreview, rowsForCatalog, sourceExercises\)/,'Factory fallback must target missing sentence numbers rather than only wholly absent stages.');
assert.match(edge,/offset \+= 12[\s\S]*Return exactly \{\"\$\{stage\}\":\[\.\.\.\]\}/,'Factory AI fallback must use small stage-specific batches with an explicit response shape.');
assert.match(edge,/incompleteReview[\s\S]*allowIncomplete/,'Incomplete grammar stages must require an explicit publication decision.');
assert.match(admin,/data-factory-confirm-incomplete[\s\S]*confirmFactory\(true\)/,'Admin must show coverage and require explicit confirmation before publishing an incomplete catalog.');
assert.match(edge,/factory_regenerate[\s\S]*factoryRegenerate/,'Factory catalog regeneration must be an authenticated explicit admin operation.');
assert.match(edge,/replaceExistingCatalog[\s\S]*ready_workbook_catalogs"\)\.update\(catalogRow\)[\s\S]*factory_job_id/,'Regeneration must atomically update the catalog tied to its original factory job.');
assert.doesNotMatch(edge,/factoryRegenerate[\s\S]{0,1200}ready_workbook_catalogs"\)\.delete/,'Regeneration must never delete the live catalog before replacement.');
assert.match(admin,/data-regenerate-workbook[\s\S]*regenerateFactoryWorkbook/,'Admin must expose regeneration only for factory-backed workbooks.');
console.log('READY Workbook Factory golden paths verified.');
