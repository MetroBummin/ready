// Static surface checks: only the sentence-practice app, its API and its
// tooling remain, and the client, server, scripts and CI agree.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = path => readFileSync(join(repo, path), 'utf8');
const walk = dir => readdirSync(join(repo, dir)).flatMap(name => { const path = join(dir, name); return statSync(join(repo, path)).isDirectory() ? walk(path) : [path]; });

// 1. Exactly the runtime files the practice app needs.
assert.deepEqual(walk('ready').map(path => relative('ready', path)).sort(), [
  'README.md', 'admin/app.js', 'admin/index.html', 'admin/sentence-rows.js', 'api.js', 'app.js', 'config.js', 'design.css',
  'deterministic-grading.js', 'index.html', 'practice-view.js', 'ready.css', 'sentence-audio.js', 'sentence-practice.js', 'workbook-interaction.js', 'workbook-progress.js',
]);
assert.deepEqual(readdirSync(join(repo, 'server/ready')).sort(), ['auth-core.mjs', 'index.ts']);
assert.deepEqual(readdirSync(join(repo, 'tools')).sort(), ['build-pages.mjs']);
for (const removed of ['design-preview.html', 'word-learning-preview.html', 'word-learning-mobile-frame.html', 'UI_AUDIT.md', 'artifacts', 'modules', 'ready/dormant', 'ready/workbooks']) assert.equal(existsSync(join(repo, removed)), false, `${removed} is removed`);

// 2. No removed feature is referenced by runtime code. ready/design.css is the
// shared design-system layer and intentionally keeps its existing selectors.
const runtime = [...walk('ready').filter(path => /\.(?:js|html)$/.test(path)), 'server/ready/index.ts', 'supabase/functions/ready/index.ts', 'supabase/functions/ready/deno.json'];
const forbidden = /gemini|generativelanguage|reader-inline-gloss|word_lookup|saved_words|review-export|shorts|student_workbook|student_question|translation_ai|studio_|factory_|content.claim|pdfjs|workbook-writing|workbook-assistance|ready_questions|ready_attempts\b/i;
for (const path of runtime) assert.doesNotMatch(read(path), forbidden, `${path} references a removed feature`);

// 3. Client ops are exactly served by the server.
const server = read('server/ready/index.ts');
const opSet = name => [...server.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`))[1].matchAll(/"([a-z_]+)"/g)].map(match => match[1]);
const serverOps = new Set([...opSet('adminOps'), ...opSet('studentOps'), ...opSet('publicOps'), 'logout']);
const clientOps = path => [...read(path).matchAll(/(?:call|readyApi)\('([a-z_]+)'/g)].map(match => match[1]);
const usedOps = new Set([...clientOps('ready/app.js'), ...clientOps('ready/admin/app.js')]);
for (const op of usedOps) assert.ok(serverOps.has(op), `client op ${op} is served`);
const clientSource = read('ready/app.js') + read('ready/admin/app.js');
for (const op of serverOps) assert.ok(clientSource.includes(`'${op}'`), `server op ${op} is used by a client`);
for (const op of read('ready/api.js').match(/READ_ONLY_OPS = new Set\(\[([^\]]*)\]/)[1].match(/'([a-z_]+)'/g).map(value => value.slice(1, -1))) assert.ok(serverOps.has(op), `retry op ${op} exists`);
assert.deepEqual([...server.matchAll(/from "([^"]+)"/g)].map(match => match[1]), ['jsr:@supabase/supabase-js@2', './auth-core.mjs', '../../ready/sentence-practice.js', '../../ready/workbook-progress.js']);
assert.match(read('supabase/functions/ready/index.ts'), /import "\.\.\/\.\.\/\.\.\/server\/ready\/index\.ts";/);
assert.deepEqual(JSON.parse(read('supabase/functions/ready/deno.json')), { imports: {} });

// 4. One named constant controls step-2 tolerance; step 2 never plays audio.
const constantFiles = ['ready', 'server', 'tools', 'tests', 'supabase'].flatMap(walk).filter(path => /\.(?:js|mjs|ts)$/.test(path) && /^\s*(?:export\s+)?(?:const|let|var)\s+LONG_SENTENCE_WORD_THRESHOLD\s*=/m.test(read(path)));
assert.deepEqual(constantFiles, ['ready/sentence-practice.js']);
assert.match(read('ready/sentence-practice.js'), /export const LONG_SENTENCE_WORD_THRESHOLD = 12;/);
assert.match(read('ready/sentence-practice.js'), /wordCount\) >= LONG_SENTENCE_WORD_THRESHOLD \? 1 : 0/);
const app = read('ready/app.js');
assert.match(app, /stepUsesAudio\(practice\.step\) && sentenceAudioSupported\(\)/, 'the audio button depends on the step');
assert.match(app, /phase: stepShowsPreview\(practice\.step\) \? 'preview' : 'order'/, 'only step 1 opens on the preview card');
assert.match(read('ready/sentence-practice.js'), /export function stepShowsPreview\(step\) \{ return Number\(step\) === 1; \}/);
const view = read('ready/practice-view.js');
assert.match(view, /isLongSentence\(view\.item\.words\.length\)/, 'the long-sentence layout uses the shared threshold');
assert.doesNotMatch(view, /\b12\b/, 'no hard-coded 12 in the practice screen');
assert.doesNotMatch(app + read('ready/design.css'), /(?:[<>]=?|===?)\s*12\b/, 'no word-count comparison with a literal 12');
assert.doesNotMatch(read('ready/sentence-practice.js') + app, /VISIBLE_CHIP_LIMIT|batchIndex/, 'chips are not shown in batches');
assert.doesNotMatch(app, /localStorage\.setItem\([^)]*bookmark[^)]*\)[^;]*call\(|call\('[a-z_]*bookmark/i, 'bookmarks stay on the device');
assert.doesNotMatch(read('ready/sentence-practice.js'), /\b(?:a|an|the)\b['"]\s*[,\]]/i, 'no article stop-word list');

// 5. Student page has only login, home and practice.
const html = read('ready/index.html');
assert.deepEqual([...html.matchAll(/<section id="([^"]+)"/g)].map(match => match[1]), ['student-home', 'student-sets', 'student-workbook']);
assert.doesNotMatch(html, /student-nav|Review/);

// 6. Scripts and CI agree.
const pkg = JSON.parse(read('package.json'));
for (const script of ['test', 'ready:test', 'test:all', 'build', 'native:build', 'native:sync', 'native:verify']) assert.ok(pkg.scripts[script], `${script} script exists`);
for (const command of Object.values(pkg.scripts)) for (const match of command.matchAll(/node (?:--test )?((?:tests|tools)\/[^\s&]+)/g)) assert.ok(existsSync(join(repo, match[1])), `${match[1]} exists`);
for (const workflow of readdirSync(join(repo, '.github/workflows'))) for (const match of read(`.github/workflows/${workflow}`).matchAll(/npm run ([\w:-]+)/g)) assert.ok(pkg.scripts[match[1]], `${workflow} runs existing script ${match[1]}`);
assert.equal(pkg.dependencies?.['pdfjs-dist'], undefined, 'PDF import dependency is removed');

// 7. Every table from the migrations is either used by the server or listed as dormant.
const migrations = readdirSync(join(repo, 'supabase/migrations')).sort().map(name => read(`supabase/migrations/${name}`)).join('\n');
const created = new Set([...migrations.matchAll(/create table (?:if not exists )?public\.(ready_[a-z_]+)/g)].map(match => match[1]));
const dropped = new Set([...migrations.matchAll(/drop table if exists public\.(ready_[a-z_]+)/g)].map(match => match[1]));
const live = [...created].filter(table => !dropped.has(table));
const used = new Set([...server.matchAll(/(?:from|allRows<[^>]*>)\("(ready_[a-z_]+)"/g)].map(match => match[1]));
const listed = doc => new Set([...read(doc).split('## Dormant database tables')[1].split(/\n## /)[0].matchAll(/^- `(ready_[a-z_]+)`/gm)].map(match => match[1]));
for (const doc of ['PRACTICE_NOTES.md', 'README.md']) {
  const dormant = listed(doc);
  assert.deepEqual([...dormant].sort(), live.filter(table => !used.has(table)).sort(), `${doc} lists every dormant table`);
}
assert.equal(readdirSync(join(repo, 'supabase/migrations')).sort().at(-1), '20260914141223_supersede_verified_publisher_import_job.sql', 'no new migration was added');

console.log('READY sentence-practice static surface verified.');
