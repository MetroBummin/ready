import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/workbook-production-golden.json',import.meta.url),'utf8'));
assert.equal(fixture.catalogs.length,13);
assert.deepEqual(Object.fromEntries(Object.entries(fixture.relationships).map(([key,value])=>[key,value.count])),{questions:130,examPassages:17,workbookAttempts:20});
for(const row of fixture.catalogs){assert.notEqual(row.catalog.contractVersion,'semantic-v2');assert.ok(row.catalog.stages.some(stage=>Number(stage.stage)===7));}
const audit=JSON.parse(readFileSync(new URL('./fixtures/workbook-semantic-source-audit.json',import.meta.url),'utf8'));
assert.equal(audit.catalogs.length,13);
assert.equal(audit.publishGate.requiredUnresolved,0);
assert.equal(audit.publishGate.ready,false,'A missing original source must block the atomic production replacement.');
assert.ok(audit.catalogs.some(row=>row.sourceStatus!=='verified'));
console.log('READY 13-catalog source-regeneration gate verified (publication blocked until unresolved=0).');
