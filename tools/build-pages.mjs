import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const nativeBuild = process.env.READY_NATIVE_BUILD === '1';

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, 'ready'), output, { recursive: true });
await cp(resolve(root, 'styles'), resolve(output, 'styles'), { recursive: true });
await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
await cp(resolve(root, 'modules'), resolve(output, 'modules'), { recursive: true });
await cp(resolve(root, 'design-tokens.css'), resolve(output, 'design-tokens.css'));
if (nativeBuild) await rm(resolve(output, 'admin'), { recursive: true, force: true });

async function replace(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  await writeFile(path, source);
}

await replace(resolve(output, 'index.html'), [
  ['../assets/', 'assets/'],
  ['../styles/', 'styles/'],
  ['../design-tokens.css', 'design-tokens.css'],
]);
if (!nativeBuild) {
  await replace(resolve(output, 'admin/index.html'), [
    ['../../assets/', '../assets/'],
    ['../../styles/', '../styles/'],
    ['../../design-tokens.css', '../design-tokens.css'],
  ]);
}
await replace(resolve(output, 'reader-inline-gloss.js'), [
  ["../modules/lexical/core.js", "./modules/lexical/core.js"],
]);
await writeFile(resolve(output, '.nojekyll'), '');

const student = await readFile(resolve(output, 'index.html'), 'utf8');
const admin = nativeBuild ? '' : await readFile(resolve(output, 'admin/index.html'), 'utf8');
const readerGloss = await readFile(resolve(output, 'reader-inline-gloss.js'), 'utf8');
const lexicalCore = await readFile(resolve(output, 'modules/lexical/core.js'), 'utf8');
if (/\.\.\/(?:assets|styles)\//.test(student) || /\.\.\/\.\.\/(?:assets|styles)\//.test(admin)) {
  throw new Error('GitHub Pages build contains unresolved parent asset paths.');
}
if (!readerGloss.includes("import './modules/lexical/core.js';") || !lexicalCore.includes('globalThis.BreezeLexical')) {
  throw new Error('GitHub Pages build is missing the shared lexical runtime.');
}

console.log(nativeBuild ? 'READY student-only native bundle built in dist/.' : 'READY GitHub Pages bundle built in dist/.');
