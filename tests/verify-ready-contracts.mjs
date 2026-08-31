import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');
const admin=read('ready/admin/app.js');
const student=read('ready/app.js');
const edge=read('server/ready/index.ts');
const types=read('ready/QUESTION_TYPES.md');
const importing=read('ready/QUESTION_IMPORT.md');
const inventory=read('ready/inventory/2026-06-busan-18-28.md');
const importer=read('tools/ready-import-questions.mjs');
const writtenStructurer=read('tools/ready-structure-written-with-codex.mjs');
const writtenContract=read('tools/ready-written-contract.mjs');

const operationPattern=/(?:call|readyApi|record)\(['"]([a-z_]+)['"]/g;
const clientOps=new Set([...admin.matchAll(operationPattern),...student.matchAll(operationPattern)].map(match=>match[1]));
const serverOps=new Set([...edge.matchAll(/case "([a-z_]+)"/g)].map(match=>match[1]));
const serverOnlyOps=new Set(['create_passage','delete_student','delete_passage','import_questions','import_explanations']);
for(const op of clientOps)assert(serverOps.has(op),`Frontend operation has no server contract: ${op}`);
for(const op of serverOps)assert(clientOps.has(op)||serverOnlyOps.has(op),`Server operation has no active caller: ${op}`);

assert.match(types,/Question-first[\s\S]*plain prose/,'Question-first product boundary is undocumented');
assert.match(types,/multiple_choice[\s\S]*written_response/,'Two grading contracts are undocumented');
assert.match(types,/Standard Multiple Choice[\s\S]*Annotated Multiple Choice[\s\S]*Structural Multiple Choice[\s\S]*Summary Completion[\s\S]*Written Response/,'Renderer families are incomplete');
assert.match(types,/raw HTML/,'Structured payload rule is missing');
assert.match(types,/마지막 Attempt가 오답/,'Latest-attempt review rule is missing');
assert.match(importing,/PDF[\s\S]*source exam[\s\S]*canonical Passage ID[\s\S]*atomic import/,'Import flow is incomplete');
assert.match(importing,/private structured Question bundle|private JSON bundle/,'Copyright-safe private bundle boundary is missing');
assert.match(importer,/mode:apply\?'apply':'dry-run'/,'Importer is not dry-run by default');
assert.match(importer,/READY_API_URL[\s\S]*READY_ADMIN_PASSWORD/,'Apply-mode credentials are not environment-only');
assert.match(writtenStructurer,/codex[\s\S]*--output-schema[\s\S]*confidence>=0\.85[\s\S]*status:'drop'/,'Written-response imports do not pass through the fail-closed Codex structure-and-verify gate');
assert.match(writtenStructurer,/validateWrittenStructure/,'Written-response structuring bypasses the deterministic contract');
assert.match(writtenContract,/response_slots\.length!==accepted\.length[\s\S]*word count[\s\S]*continuous student-passage range/,'AI-written specs are not deterministically checked against answers and source text');
assert.match(inventory,/\| 1 \| 40[\s\S]*\| 2 \| 41[\s\S]*\| 3 \| 24[\s\S]*\| 4 \| 32[\s\S]*\*\*137\*\*/,'18-28 inventory totals are incorrect');
for(const passage of [18,19,20,21,22,23,24,25,26,27,28])assert.match(inventory,new RegExp(`\\| ${passage} \\|`),`Passage ${passage} is missing from inventory`);
assert.match(inventory,/Question 32 \(Passage 25 chart\)/,'Chart asset limitation is not reported');

const migrations=readdirSync(resolve(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
assert.ok(migrations.includes('20260828150000_ready_question_first.sql'),'Question-first migration is missing');
assert.doesNotMatch(student+admin,/SUPABASE_SERVICE_ROLE_KEY|READY_ADMIN_PASSWORD|GEMINI_API_KEY/,'A server secret name leaked into frontend code');
assert.doesNotMatch(student,/reader-token|learning-sheet|data-save-sentence/,'Student frontend still exposes lexical study controls');

console.log(`READY API contracts verified (${clientOps.size} frontend operations, 137 inventoried questions).`);
