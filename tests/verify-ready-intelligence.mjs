import assert from 'node:assert/strict';
import { lemma, tokenizeSentence } from '../server/ready/lexical-core.mjs';

assert.equal(lemma('made'),'make');
assert.equal(lemma('Making'),'make');
assert.equal(lemma('studies'),'study');
assert.equal(lemma('analysis'),'analysis');

const tokens=tokenizeSentence("She made students' lives better.");
assert.deepEqual(tokens.map(token=>token.surface),['She','made','students','lives','better']);
assert.equal(tokens[1].lemma,'make');
assert.equal(tokens[3].lemma,'life');
assert.equal(tokens[1].startOffset,4);
assert.equal(tokens[1].endOffset,8);
assert.deepEqual(tokenizeSentence('The same text.').map(token=>token.lemma),tokenizeSentence('The same text.').map(token=>token.lemma),'Reader tokenization is not deterministic');

console.log('READY deterministic Reader tokenization verified');
