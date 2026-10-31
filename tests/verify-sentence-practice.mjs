// Unit tests for the step-1 / step-2 sentence-ordering policy.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LONG_SENTENCE_WORD_THRESHOLD, PRACTICE_STEPS, attemptPayload, builtSentence, gradeSentenceAttempt, mistakeAllowance,
  placeWord, practiceItem, practiceItems, runIsClean, sentenceWords, startRun, stepUsesAudio, visibleChips, shuffleChangedOrder,
} from '../ready/sentence-practice.js';
import { pickEnglishVoice, sentenceAudioSupported, speakSentence } from '../ready/sentence-audio.js';
import { clearWorkbookCycleItem } from '../ready/workbook-progress.js';
import { matchEditorRows, parseSentenceRows } from '../ready/admin/sentence-rows.js';

const sentence = (words, id = 's1') => practiceItem({ id, text: `${words.join(' ')}.`, translation: '해석' });
const nWords = count => Array.from({ length: count }, (_, index) => `w${index + 1}`);
// Chip indexes equal word positions, so chip i is the i-th word of the answer.
const placeAll = (item, run, from = run.chosen.length) => { let result = { run }; for (let index = from; index < item.words.length; index += 1) result = placeWord(item, result.run, index); return result; };
const wrongChip = (item, run) => item.words.findIndex((word, index) => !run.consumed.includes(index) && word !== item.words[run.chosen.length]);

test('LONG_SENTENCE_WORD_THRESHOLD is exactly 12 and steps are 1 and 2', () => {
  assert.equal(LONG_SENTENCE_WORD_THRESHOLD, 12);
  assert.deepEqual([...PRACTICE_STEPS], [1, 2]);
});

test('articles a / an / the are kept as chips and must be placed', () => {
  const item = practiceItem({ id: 'a', text: 'The boy ate an apple and a pear in the park.', translation: '소년은 공원에서 사과 하나와 배 하나를 먹었다.' });
  assert.deepEqual(item.words, ['The', 'boy', 'ate', 'an', 'apple', 'and', 'a', 'pear', 'in', 'the', 'park']);
  assert.equal(item.answer, 'The boy ate an apple and a pear in the park');
  for (const article of ['The', 'an', 'a', 'the']) assert.ok(item.words.includes(article), `${article} must be a chip`);
  const run = startRun(item, 1), chips = visibleChips(item, run, {}, () => 0.3).visible;
  assert.ok(chips.some(index => item.words[index] === 'The'), 'the first batch shows the leading article');
  const done = placeAll(item, run);
  assert.equal(done.type, 'complete');
  assert.equal(builtSentence(item, done.run), item.answer, 'the finished sentence contains every article');
  assert.equal(gradeSentenceAttempt({ text: item.text, ...attemptPayload(item, done.run) }).valid, true);
  assert.equal(gradeSentenceAttempt({ text: item.text, step: 1, arranged: 'boy ate apple and pear in park', mistakes: 0, restarts: 0 }).reason, 'incomplete_sentence', 'dropping articles is not a finished sentence');
});

test('tokenizer keeps contractions and number-bearing words whole and ignores punctuation', () => {
  assert.deepEqual(sentenceWords("It's 10,000 won, isn't it?"), ["It's", '10,000', 'won', "isn't", 'it']);
  assert.deepEqual(sentenceWords('About 1.5% of CO₂ — not 15.'), ['About', '1.5%', 'of', 'CO₂', 'not', '15']);
  assert.equal(practiceItem({ id: 'x', text: 'Hello.', translation: '안녕' }), null, 'one-word rows cannot be ordered');
  assert.equal(practiceItems([{ id: 't', text: 'A Title Row', translation: '', block_type: 'TITLE' }, { id: 's', text: 'Two words', translation: '두 단어' }]).length, 1);
});

test('step 1 shows a mistake quietly and the student keeps going', () => {
  const item = sentence(nWords(5));
  let run = startRun(item, 1);
  run = placeWord(item, run, 0).run;
  const wrong = placeWord(item, run, 3);
  assert.equal(wrong.type, 'mistake');
  assert.deepEqual(wrong.run.chosen, [0], 'progress is kept');
  assert.equal(wrong.run.lastWrongChip, 3);
  assert.equal(wrong.run.restarts, 0);
  let result = wrong;
  for (let index = 0; index < 20; index += 1) result = placeWord(item, result.run, 4);
  assert.equal(result.type, 'mistake', 'step 1 never restarts, even after many mistakes');
  assert.equal(result.run.mistakes, 21);
  const done = placeAll(item, result.run);
  assert.equal(done.type, 'complete');
  assert.equal(done.run.restarts, 0);
  assert.equal(runIsClean(done.run), false, 'a step-1 run with mistakes is recorded as not clean');
  assert.equal(runIsClean(placeAll(item, startRun(item, 1)).run), true);
  assert.equal(mistakeAllowance(1, 3), Infinity);
  assert.equal(mistakeAllowance(1, 30), Infinity);
});

test('step 2 restarts the sentence on a mistake', () => {
  const item = sentence(nWords(6));
  let run = startRun(item, 2);
  run = placeWord(item, placeWord(item, run, 0).run, 1).run;
  assert.deepEqual(run.chosen, [0, 1]);
  const wrong = placeWord(item, run, 5);
  assert.equal(wrong.type, 'restart');
  assert.deepEqual(wrong.run.chosen, [], 'the sentence starts from the beginning');
  assert.deepEqual(wrong.run.consumed, []);
  assert.equal(wrong.run.restarts, 1);
  const done = placeAll(item, wrong.run);
  assert.equal(done.type, 'complete');
  assert.equal(runIsClean(done.run), false);
  assert.equal(runIsClean(placeAll(item, startRun(item, 2)).run), true);
});

test('11-word sentence has zero tolerance in step 2', () => {
  const item = sentence(nWords(11));
  assert.equal(item.words.length, 11);
  assert.equal(mistakeAllowance(2, 11), 0);
  const run = startRun(item, 2);
  assert.equal(run.allowance, 0);
  assert.equal(placeWord(item, run, wrongChip(item, run)).type, 'restart', 'the first mistake already restarts');
});

test('12+ word sentences tolerate exactly one mistake in step 2; the second restarts', () => {
  for (const count of [12, 13, 20]) {
    const item = sentence(nWords(count));
    assert.equal(mistakeAllowance(2, count), 1);
    let run = startRun(item, 2);
    run = placeWord(item, run, 0).run;
    const first = placeWord(item, run, wrongChip(item, run));
    assert.equal(first.type, 'mistake', `${count} words: first mistake is tolerated`);
    assert.deepEqual(first.run.chosen, [0], 'the student continues from the same place');
    const resumed = placeWord(item, first.run, 1);
    assert.equal(resumed.type, 'correct');
    const second = placeWord(item, resumed.run, wrongChip(item, resumed.run));
    assert.equal(second.type, 'restart', `${count} words: second mistake restarts`);
    assert.deepEqual(second.run.chosen, []);
    assert.equal(second.run.restarts, 1);
    assert.equal(second.run.runMistakes, 0, 'the tolerance resets for the new run');
    assert.equal(placeWord(item, second.run, wrongChip(item, second.run)).type, 'mistake', 'one mistake is tolerated again after a restart');
    const tolerated = placeAll(item, placeWord(item, startRun(item, 2), wrongChip(item, startRun(item, 2))).run);
    assert.equal(tolerated.type, 'complete');
    assert.equal(runIsClean(tolerated.run), true, 'one tolerated mistake still counts as a clean step-2 pass');
  }
});

test('duplicate words are interchangeable chips', () => {
  const item = practiceItem({ id: 'd', text: 'the cat saw the dog', translation: '고양이가 개를 봤다' });
  let result = placeWord(item, startRun(item, 2), 3);
  assert.equal(result.type, 'correct', 'either "the" chip may come first');
  result = placeWord(item, result.run, 1);
  result = placeWord(item, result.run, 2);
  result = placeWord(item, result.run, 0);
  result = placeWord(item, result.run, 4);
  assert.equal(result.type, 'complete');
  assert.equal(builtSentence(item, result.run), 'the cat saw the dog');
});

test('chips appear in shuffled batches of up to six and a used chip is ignored', () => {
  const item = sentence(nWords(14)), orders = {}, run = startRun(item, 1);
  const first = visibleChips(item, run, orders, Math.random);
  assert.equal(first.visible.length, 6);
  assert.deepEqual([...first.visible].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  assert.notDeepEqual(first.visible, [0, 1, 2, 3, 4, 5], 'a batch is never shown in answer order');
  assert.deepEqual(visibleChips(item, run, orders).visible, first.visible, 'the order is stable within a batch');
  let next = run; for (let index = 0; index < 6; index += 1) next = placeWord(item, next, index).run;
  assert.equal(visibleChips(item, next, orders).batchIndex, 1);
  assert.equal(placeWord(item, next, 0).type, 'ignore');
  assert.deepEqual(shuffleChangedOrder([7, 8], () => 0.99), [8, 7]);
});

test('server grading re-checks the arrangement and step policy', () => {
  const short = sentence(nWords(5)), long = sentence(nWords(12));
  assert.deepEqual(gradeSentenceAttempt({ text: short.text, step: 1, arranged: short.answer, mistakes: 0, restarts: 0 }), { valid: true, correct: true, wordCount: 5, allowance: null });
  assert.equal(gradeSentenceAttempt({ text: short.text, step: 1, arranged: short.answer, mistakes: 2, restarts: 0 }).correct, false);
  assert.equal(gradeSentenceAttempt({ text: short.text, step: 1, arranged: short.answer, mistakes: 1, restarts: 1 }).reason, 'step1_never_restarts');
  assert.equal(gradeSentenceAttempt({ text: short.text, step: 2, arranged: short.answer, mistakes: 1, restarts: 0 }).reason, 'step2_counts_inconsistent', 'a short step-2 mistake must have restarted');
  assert.equal(gradeSentenceAttempt({ text: short.text, step: 2, arranged: short.answer, mistakes: 2, restarts: 2 }).correct, false);
  assert.equal(gradeSentenceAttempt({ text: long.text, step: 2, arranged: long.answer, mistakes: 1, restarts: 0 }).correct, true);
  assert.equal(gradeSentenceAttempt({ text: long.text, step: 2, arranged: long.answer, mistakes: 3, restarts: 1 }).correct, false);
  assert.equal(gradeSentenceAttempt({ text: long.text, step: 2, arranged: long.answer, mistakes: 4, restarts: 1 }).valid, false);
  assert.equal(gradeSentenceAttempt({ text: short.text, step: 3, arranged: short.answer, mistakes: 0, restarts: 0 }).reason, 'unknown_step');
  assert.equal(gradeSentenceAttempt({ text: short.text, step: 1, arranged: short.answer, mistakes: -1, restarts: 0 }).reason, 'invalid_counter');
  assert.equal(gradeSentenceAttempt({ text: short.text, step: 1, arranged: 'w2 w1 w3 w4 w5', mistakes: 0, restarts: 0 }).reason, 'incomplete_sentence');
});

test('step 1 has sentence audio, step 2 has none', () => {
  assert.equal(stepUsesAudio(1), true);
  assert.equal(stepUsesAudio(2), false);
  const spoken = [];
  class Utterance { constructor(text) { this.text = text; } }
  const win = { SpeechSynthesisUtterance: Utterance, speechSynthesis: { cancel() { spoken.push('cancel'); }, speak(utterance) { spoken.push(utterance); }, getVoices: () => [{ lang: 'ko-KR' }, { lang: 'en-GB' }, { lang: 'en-US', localService: true }] } };
  assert.equal(sentenceAudioSupported(win), true);
  assert.equal(sentenceAudioSupported({}), false);
  assert.equal(speakSentence('The cat sat.', { win }), true);
  assert.equal(spoken[1].text, 'The cat sat.');
  assert.equal(spoken[1].lang, 'en-US');
  assert.equal(spoken[1].voice.lang, 'en-US');
  assert.equal(speakSentence('Hello', { win: {} }), false, 'no Web Speech support means no audio, not an error');
  assert.equal(pickEnglishVoice([{ lang: 'en_GB' }]).lang, 'en_GB');
});

test('cycle progress counts each sentence once and closes after all sentences', () => {
  let progress = clearWorkbookCycleItem({}, 'sentence:a', 2);
  assert.equal(progress.correctClears, 1);
  assert.equal(clearWorkbookCycleItem(progress, 'sentence:a', 2).advanced, false);
  progress = clearWorkbookCycleItem(progress, 'sentence:b', 2);
  assert.deepEqual([progress.completedCycles, progress.currentCycle, progress.currentCycleClears.length], [1, 2, 0]);
});

test('admin sentence editor parses TAB rows and keeps sentence ids', () => {
  const parsed = parseSentenceRows('One two.\t하나 둘\n\nThree four.\t셋 넷\n');
  assert.deepEqual(parsed, { rows: [{ text: 'One two.', translation: '하나 둘' }, { text: 'Three four.', translation: '셋 넷' }], errors: [] });
  assert.equal(parseSentenceRows('no tab here').errors.length, 1);
  assert.equal(parseSentenceRows('').errors.length, 1);
  const previous = [{ id: 'a', text: 'One two.' }, { id: 'b', text: 'Three four.' }];
  assert.deepEqual(matchEditorRows(previous, [{ text: 'New first.', translation: '새' }, { text: 'One two.', translation: '하나' }, { text: 'Three four!', translation: '셋' }]).map(row => row.id), [null, 'a', null], 'a moved line keeps its id by text; a brand-new position gets a new id');
  assert.deepEqual(matchEditorRows(previous, [{ text: 'One two, edited.', translation: '하나' }]).map(row => row.id), ['a'], 'an edited line keeps its position id');
});
