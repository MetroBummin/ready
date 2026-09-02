import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractUnicodePdfText } from '../server/ready/pdf-text-extract.mjs';

const source = readFileSync(new URL('../ready/workbooks/ne-minbyeongcheon-lesson-1.pdf', import.meta.url)).toString('base64');
const text = await extractUnicodePdfText(source);

assert.match(text, /A missing hiker named Rene Compean was found safe on/);
assert.match(text, /Rene Compean 이라는 실종된 등산객/);
assert.ok((text.match(/[가-힣]/g) || []).length > 1_000, 'Korean text layer should be decoded');
assert.doesNotMatch(text, /ëzd|Ã.|ÿ/, 'CID glyph bytes must not reach the review UI');

console.log('READY PDF Unicode extraction checks passed.');
