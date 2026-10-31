// READY sentence-ordering practice: the shared step policy.
//
// This module is imported by the student app (browser), by the READY Edge
// Function (Deno), and by Node tests, so it must stay dependency-free ESM.
//
// Step 1: preview card (English sentence + audio, Korean hidden until tapped),
//         then ordering with the Korean prompt and audio. A wrong chip is
//         shown quietly and the student keeps going.
// Step 2: no preview, no audio: straight to ordering with the Korean prompt.
//         A wrong chip restarts the sentence, except that sentences with
//         LONG_SENTENCE_WORD_THRESHOLD or more words tolerate exactly one
//         mistake per run.
//
// Every chip of the sentence is visible at once, shuffled once per run.
import { normalizeWorkbookOrderAnswer } from './deterministic-grading.js';
import { shuffleWorkbookOrderBatch, workbookOrderClick } from './workbook-interaction.js';

export const LONG_SENTENCE_WORD_THRESHOLD = 12;
export const PRACTICE_STEPS = Object.freeze([1, 2]);
export const SENTENCE_PRACTICE_CONTRACT = 'sentence-practice-v1';
export const SENTENCE_PRACTICE_WORKBOOK_KEY = 'sentence-practice';
export const SENTENCE_TOKENIZER_VERSION = 'order-tokens-v2';
const MAX_COUNTER = 999;

const cleanText = value => String(value ?? '').replace(/\u0000|[\uD800-\uDFFF]/g, '').replace(/\u00a0/g, ' ').trim().slice(0, 6000);

// Same tokenizer as the former Workbook factory `orderTokenParts`
// (order-tokens-v2): every word is a chip, including the articles a/an/the,
// and number-bearing terms such as 10,000, 1.5, 15-20% or CO₂ stay whole.
// Punctuation that is not inside a word is not a chip.
export function sentenceWords(text) {
  return cleanText(text).match(/(?:[$€£₩¥#])?[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+|[.,/‐‑‒–—−-][\p{L}\p{M}\p{N}]+)*%?/gu) || [];
}

export function isPracticeStep(step) { return PRACTICE_STEPS.includes(Number(step)); }

// How many wrong chips one run of a sentence may contain before it restarts.
export function mistakeAllowance(step, wordCount) {
  if (Number(step) === 1) return Infinity;
  if (Number(step) === 2) return Number(wordCount) >= LONG_SENTENCE_WORD_THRESHOLD ? 1 : 0;
  throw new Error(`Unknown practice step: ${step}`);
}

export function stepUsesAudio(step) { return Number(step) === 1; }
// Only step 1 shows the English sentence before ordering (the preview card).
export function stepShowsPreview(step) { return Number(step) === 1; }
// The same threshold that sets the step-2 tolerance also switches the
// practice screen to its compact long-sentence layout.
export function isLongSentence(wordCount) { return Number(wordCount) >= LONG_SENTENCE_WORD_THRESHOLD; }
export function practiceItemKey(sentenceId) { return `sentence:${String(sentenceId ?? '').trim()}`; }
export function practiceProgressKey(step) { return `sentence_order_step${Number(step)}`; }

// A practice item is one canonical English/Korean sentence pair. Sentences
// with fewer than two words cannot be ordered and are skipped.
export function practiceItem(sentence = {}) {
  const text = cleanText(sentence.text), translation = cleanText(sentence.translation), words = sentenceWords(text);
  if (words.length < 2 || !translation) return null;
  return { key: practiceItemKey(sentence.id), sentenceId: String(sentence.id ?? ''), text, translation, words, answer: words.join(' ') };
}

export function practiceItems(sentences = []) {
  return (Array.isArray(sentences) ? sentences : [])
    .filter(sentence => String(sentence?.block_type || sentence?.blockType || 'SENTENCE').toUpperCase() === 'SENTENCE' && sentence?.active !== false)
    .map(practiceItem).filter(Boolean);
}

export function startRun(item, step) {
  if (!isPracticeStep(step)) throw new Error(`Unknown practice step: ${step}`);
  return { step: Number(step), allowance: mistakeAllowance(step, item.words.length), chosen: [], consumed: [], runMistakes: 0, mistakes: 0, restarts: 0, completed: false, lastWrongChip: null };
}

// Applies one chip tap. Returns { type, run } where type is one of:
//   ignore   - not a playable chip (already used, out of range, finished)
//   correct  - the chip was the next word
//   complete - the chip was the last word
//   mistake  - wrong chip; the student continues from the same position
//   restart  - wrong chip beyond the allowance; the sentence starts over
export function placeWord(item, run, chipIndex) {
  if (run.completed) return { type: 'ignore', run };
  const click = workbookOrderClick(item.words, item.answer, run.chosen, run.consumed, chipIndex, { practice: true });
  if (click.type === 'ignore') return { type: 'ignore', run };
  if (click.type === 'practice-wrong') {
    const runMistakes = run.runMistakes + 1, mistakes = run.mistakes + 1;
    if (runMistakes > run.allowance) return { type: 'restart', run: { ...run, chosen: [], consumed: [], runMistakes: 0, mistakes, restarts: run.restarts + 1, lastWrongChip: chipIndex } };
    return { type: 'mistake', run: { ...run, runMistakes, mistakes, lastWrongChip: chipIndex } };
  }
  const completed = click.chosen.length === item.words.length;
  return { type: completed ? 'complete' : 'correct', run: { ...run, chosen: click.chosen, consumed: click.consumed, completed, lastWrongChip: null } };
}

export function builtSentence(item, run) { return run.chosen.map(index => item.words[index]).join(' '); }

// A clean pass: step 1 without any wrong chip, step 2 without a restart.
export function runIsClean(run) { return run.step === 1 ? run.mistakes === 0 : run.restarts === 0; }

export function attemptPayload(item, run) {
  return { sentenceId: item.sentenceId, step: run.step, arranged: builtSentence(item, run), mistakes: run.mistakes, restarts: run.restarts };
}

// Every unplaced chip, in one shuffled order per run. `orders` memoizes the
// shuffle so chip order does not change while the student works; the caller
// passes a fresh object after a step-2 restart to reshuffle. Placed chips are
// left out, so the remaining chips reflow without gaps.
export function visibleChips(item, run, orders = {}, random = Math.random) {
  if (!Array.isArray(orders.all) || orders.all.length !== item.words.length) orders.all = shuffleChangedOrder(item.words.map((_, index) => index), random);
  const used = new Set(run.consumed);
  return { visible: orders.all.filter(index => !used.has(index)) };
}

// Avoid presenting two or more chips already in sentence order.
export function shuffleChangedOrder(batch, random = Math.random) {
  let shuffled = shuffleWorkbookOrderBatch(batch, random);
  for (let tries = 0; batch.length > 1 && tries < 8 && shuffled.every((value, index) => value === batch[index]); tries += 1) shuffled = shuffleWorkbookOrderBatch(batch, random);
  if (batch.length > 1 && shuffled.every((value, index) => value === batch[index])) shuffled = [...batch.slice(1), batch[0]];
  return shuffled;
}

const counter = value => Number.isInteger(value) && value >= 0 && value <= MAX_COUNTER;

// Server-side re-check of a finished sentence. The client decides each tap
// locally; the server verifies the arrangement is the full canonical sentence
// and that the reported mistake/restart counts are consistent with the step
// policy. It cannot see individual taps (same trust model as the former
// local-first Workbook queue).
export function gradeSentenceAttempt({ text, step, arranged, mistakes, restarts }) {
  const words = sentenceWords(text);
  if (!isPracticeStep(step)) return { valid: false, reason: 'unknown_step' };
  if (words.length < 2) return { valid: false, reason: 'not_orderable' };
  if (!counter(mistakes) || !counter(restarts)) return { valid: false, reason: 'invalid_counter' };
  const expected = words.map(normalizeWorkbookOrderAnswer).join(' '), actual = String(arranged ?? '').trim().split(/\s+/).filter(Boolean).map(normalizeWorkbookOrderAnswer).join(' ');
  if (actual !== expected) return { valid: false, reason: 'incomplete_sentence' };
  const allowance = mistakeAllowance(step, words.length);
  if (Number(step) === 1 && restarts !== 0) return { valid: false, reason: 'step1_never_restarts' };
  if (Number(step) === 2) {
    const finalRunMistakes = mistakes - restarts * (allowance + 1);
    if (finalRunMistakes < 0 || finalRunMistakes > allowance) return { valid: false, reason: 'step2_counts_inconsistent' };
  }
  const correct = Number(step) === 1 ? mistakes === 0 : restarts === 0;
  return { valid: true, correct, wordCount: words.length, allowance: Number.isFinite(allowance) ? allowance : null };
}
