import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, 'ready'), output, { recursive: true });
await cp(resolve(root, 'styles'), resolve(output, 'styles'), { recursive: true });
await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });

async function replace(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  await writeFile(path, source);
}

await replace(resolve(output, 'index.html'), [
  ['../assets/', 'assets/'],
  ['../styles/', 'styles/'],
]);
await replace(resolve(output, 'admin/index.html'), [
  ['../../assets/', '../assets/'],
  ['../../styles/', '../styles/'],
]);
await writeFile(resolve(output, '.nojekyll'), '');

const student = await readFile(resolve(output, 'index.html'), 'utf8');
const admin = await readFile(resolve(output, 'admin/index.html'), 'utf8');
if (/\.\.\/(?:assets|styles)\//.test(student) || /\.\.\/\.\.\/(?:assets|styles)\//.test(admin)) {
  throw new Error('GitHub Pages build contains unresolved parent asset paths.');
}

console.log('READY GitHub Pages bundle built in dist/.');
