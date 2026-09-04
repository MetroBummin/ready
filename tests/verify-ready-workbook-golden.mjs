import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditWorkbookCatalog,repairStageNineCatalog} from '../server/ready/workbook-catalog-qa.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/workbook-production-golden.json',import.meta.url),'utf8'));
assert.equal(fixture.version,'production_workbook_golden_v1');
assert.equal(fixture.catalogs.length,13,'Every production DB workbook catalog must remain represented in the golden set.');
assert.equal(fixture.generatedFrom.auditedCanonicalSentences,598,'The audited canonical sentence baseline must not be silently replaced.');
assert.equal(fixture.generatedFrom.representedCanonicalSentences,fixture.sentences.length,'Every catalog-linked canonical sentence must remain in the redacted golden fixture.');

const byPassage=new Map();
for(const row of fixture.sentences){if(!byPassage.has(row.passage_id))byPassage.set(row.passage_id,[]);byPassage.get(row.passage_id).push(row);}
let stageNineItems=0;
for(const row of fixture.catalogs){
  const canonical=(byPassage.get(row.passage_id)||[]).sort((a,b)=>Number(a.sentence_index)-Number(b.sentence_index));
  const errors=auditWorkbookCatalog(row.catalog,canonical);
  assert.deepEqual(errors,[],`${row.workbook_key} violates a Workbook Stage 5-9 invariant.`);
  const repaired=repairStageNineCatalog(row.catalog,canonical);
  assert.equal(repaired.repairs.length,0,`${row.workbook_key} must not need a Stage 9 repair.`);
  assert.equal(repaired.unresolved.length,0,`${row.workbook_key} must not contain an unresolved Stage 9 item.`);
  const stageNine=row.catalog.stages.find(stage=>Number(stage.stage)===9);
  stageNineItems+=(stageNine?.items||[]).length;
  for(const item of stageNine?.items||[]){
    assert.ok(!Array.isArray(item.wordBank)||item.wordBank.length===0||item.wordBank.join(' ')!==item.answers.join(' '),'Stage 9 must not expose the full answer as its word bank.');
  }
}
assert.ok(stageNineItems>=256,'The repaired Stage 9 production baseline must stay fully represented.');
assert.deepEqual(Object.fromEntries(Object.entries(fixture.relationships).map(([key,value])=>[key,value.count])),{questions:130,examPassages:17,workbookAttempts:20},'Workbook repair must retain the audited relationship baseline.');
for(const relation of Object.values(fixture.relationships))assert.match(relation.sha256,/^[a-f0-9]{64}$/,'Relationship baseline must include a stable digest.');

console.log(`READY production Workbook golden regression passed (${fixture.catalogs.length} catalogs, ${stageNineItems} Stage 9 items).`);
