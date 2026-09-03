import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const modulePath = process.argv[2];
if (!modulePath) throw new Error('module path required');
const { generateWorkbookCatalog } = await import(`${pathToFileURL(resolve(modulePath)).href}?t=${Date.now()}`);
const rows = Array.from({length:60}, (_, index) => ({
  text: `Sentence ${index + 1} contains unique token word${index + 1}.`,
  translation: `번역 ${index + 1}`,
}));
const sourceExercises = rows.map((row, index) => ({
  type: 'grammar_vocab_choice',
  number: index + 1,
  prompt: row.text.replace(`word${index + 1}`, '⟦CHOICE:0⟧'),
  groups: [[`wrong${index + 1}`, `word${index + 1}`]],
  answers: [`word${index + 1}`],
  provenance: { origin: 'benchmark' },
}));
const started = performance.now();
for (let iteration = 0; iteration < 8; iteration += 1) {
  generateWorkbookCatalog({ title: 'benchmark', workbookKey: `bench-${iteration}`, rows, sourceExercises });
}
console.log(`elapsed_ms=${(performance.now() - started).toFixed(1)}`);
