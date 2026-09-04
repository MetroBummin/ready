import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditWorkbookCatalog,normalizeStageEightChips,repairStageNineCatalog} from '../server/ready/workbook-catalog-qa.mjs';
import {NE_MINBYEONGCHEON_L1_WORKBOOK} from '../server/ready/workbook-ne-l1.mjs';
import {NE_MINBYEONGCHEON_L2_WORKBOOK} from '../server/ready/workbook-ne-l2.mjs';
import {YBM_PARKJUNEON_L1_WORKBOOK} from '../server/ready/workbook-ybm-l1.mjs';
import {YBM_PARKJUNEON_L2_WORKBOOK} from '../server/ready/workbook-ybm-l2.mjs';
import {DONGA_LEEBYEONGMIN_L4_WORKBOOK} from '../server/ready/workbook-donga-l4.mjs';

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
  for(const stageNumber of [5,6,7,8,9]){
    const stage=row.catalog.stages.find(candidate=>Number(candidate.stage)===stageNumber);
    assert.ok(stage?.items?.length,`${row.workbook_key} must retain at least one source-backed Stage ${stageNumber} exercise.`);
  }
  const stageSeven=row.catalog.stages.find(stage=>Number(stage.stage)===7);
  for(const item of stageSeven?.items||[]){
    assert.ok(['grammar','context'].includes(item.subtype),`${item.key} must identify whether the correction is grammatical or contextual.`);
  }
  const stageEight=row.catalog.stages.find(stage=>Number(stage.stage)===8);
  for(const item of stageEight?.items||[])for(const group of item.groupTokenCounts||[])for(const tokenCount of group){
    assert.equal(tokenCount,1,`${item.key} must render one word per Stage 8 chip.`);
  }
  const repaired=repairStageNineCatalog(row.catalog,canonical);
  assert.equal(repaired.repairs.length,0,`${row.workbook_key} must not need a Stage 9 repair.`);
  assert.equal(repaired.unresolved.length,0,`${row.workbook_key} must not contain an unresolved Stage 9 item.`);
  const stageNine=row.catalog.stages.find(stage=>Number(stage.stage)===9);
  stageNineItems+=(stageNine?.items||[]).length;
  for(const item of stageNine?.items||[]){
    assert.equal(item.provenance?.origin,'publisher_answer_key',`${item.key} must remain backed by the publisher's semantic writing answer key.`);
    assert.equal(item.provenance?.semanticType,'writing',`${item.key} must be a semantic writing exercise, regardless of the printed workbook number.`);
    assert.equal(item.provenance?.mappedReadyStage,9,`${item.key} must map semantic writing to READY Stage 9.`);
    assert.ok(!item.qaRepair&&!item.provenance?.qaRepair,`${item.key} must not depend on a synthetic Stage 9 repair.`);
    assert.ok(!Array.isArray(item.wordBank)||item.wordBank.length===0||item.wordBank.join(' ')!==item.answers.join(' '),'Stage 9 must not expose the full answer as its word bank.');
  }
}
assert.equal(stageNineItems,257,'The source-audited semantic Stage 9 baseline must stay fully represented.');
for(const catalog of [NE_MINBYEONGCHEON_L1_WORKBOOK,NE_MINBYEONGCHEON_L2_WORKBOOK,YBM_PARKJUNEON_L1_WORKBOOK,YBM_PARKJUNEON_L2_WORKBOOK,DONGA_LEEBYEONGMIN_L4_WORKBOOK]){
  const normalized=normalizeStageEightChips(catalog).catalog,stage=normalized.stages.find(candidate=>Number(candidate.stage)===8);
  assert.ok(stage?.items?.length,`${catalog.workbookKey} must retain Stage 8 exercises.`);
  for(const item of stage.items)for(const group of item.groups||[])for(const chip of group)assert.ok(!/\s/u.test(String(chip).trim()),`${item.key} must expose one word per Stage 8 chip.`);
}
assert.deepEqual(Object.fromEntries(Object.entries(fixture.relationships).map(([key,value])=>[key,value.count])),{questions:130,examPassages:17,workbookAttempts:20},'Workbook repair must retain the audited relationship baseline.');
for(const relation of Object.values(fixture.relationships))assert.match(relation.sha256,/^[a-f0-9]{64}$/,'Relationship baseline must include a stable digest.');

console.log(`READY production Workbook golden regression passed (${fixture.catalogs.length} catalogs, ${stageNineItems} Stage 9 items).`);
