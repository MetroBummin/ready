// READY Workbook Factory.  This module deliberately contains no database or
// Gemini access so its parsing, generation and fail-closed validation can be
// exercised as a normal Node golden-path test as well as in the Edge Function.

const clean = (value, max = 6000) => String(value ?? '').replace(/\u0000|[\uD800-\uDFFF]/g, '').replace(/\u00a0/g, ' ').trim().slice(0, max);
const canonicalText = value => clean(value).normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ').trim();

export function compareCanonicalRows(existingRows, extractedRows) {
  const existing = Array.isArray(existingRows) ? existingRows : [], extracted = Array.isArray(extractedRows) ? extractedRows : [];
  if (!existing.length) return { consistent: false, reason: 'existing_canonical_missing', mismatches: [] };
  if (!extracted.length) return { consistent: false, reason: 'pdf_canonical_missing', mismatches: [] };
  if (existing.length !== extracted.length) return { consistent: false, reason: 'sentence_count_mismatch', expectedCount: existing.length, actualCount: extracted.length, mismatches: [] };
  const mismatches = [];
  existing.forEach((row, index) => {
    const fields = ['text', 'translation'].filter(field => canonicalText(row?.[field]) !== canonicalText(extracted[index]?.[field]));
    if (fields.length) mismatches.push({ sentenceIndex: index + 1, fields });
  });
  return { consistent: mismatches.length === 0, reason: mismatches.length ? 'canonical_text_mismatch' : '', expectedCount: existing.length, actualCount: extracted.length, mismatches: mismatches.slice(0, 8) };
}
const fold = value => clean(value).toLowerCase().replace(/[“”‘’]/g, "'").replace(/\s+/g, ' ');
const comparableEnglish = value => fold(value)
  .replace(/\b(i)'m\b/g, '$1 am')
  .replace(/\b(you|we|they)'re\b/g, '$1 are')
  .replace(/\b(he|she|it)'s\b/g, '$1 is')
  .replace(/\b([a-z]+)n't\b/g, (_, word) => word === 'ca' ? 'cannot' : word === 'wo' ? 'will not' : `${word} not`)
  .replace(/\b([a-z]+)'ve\b/g, '$1 have')
  .replace(/\b([a-z]+)'ll\b/g, '$1 will')
  .replace(/\b([a-z]+)'d\b/g, '$1 would')
  .replace(/\s+/g, ' ');
const sameEnglish = (left, right) => comparableEnglish(left) === comparableEnglish(right);
const words = value => clean(value).match(/[A-Za-z]+(?:[’'][A-Za-z]+)*/g) || [];
const koWords = value => clean(value).match(/[가-힣]+(?:[·ㆍ][가-힣]+)*/g) || [];
const stageMeta = {
  2: ['2단계 · 우리말 빈칸', '영문을 보고 우리말 해석의 빈칸을 완성하세요.'],
  3: ['3단계 · 영문 빈칸', '우리말 해석을 보고 영문의 빈칸을 완성하세요.'],
  4: ['4단계 · 해석 연습', '영문을 자연스러운 우리말로 해석하세요.'],
  5: ['5단계 · 동사형', '주어진 동사를 문장에 맞는 형태로 고쳐 쓰세요.'],
  6: ['6단계 · 어법·어휘 선택', '각 구간에서 알맞은 표현을 고르세요.'],
  7: ['7단계 · 오류 찾기', '어색한 표현을 찾아 알맞게 고쳐 쓰세요.'],
  8: ['8단계 · 순서 배열', '주어진 단어를 문장 순서로 배열하세요.'],
  9: ['9단계 · 영작 연습', '우리말 해석을 보고 영문을 완성하세요.'],
};

export const FACTORY_STAGES = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9]);

export function semanticWorkbookType(label) {
  const text = fold(label);
  if (/paragraph|문단\s*(순서|배열)|단락\s*(순서|배열)/.test(text)) return 'paragraph_ordering';
  if (/check|mixed|종합\s*(문제|평가)|확인\s*문제/.test(text)) return 'check_mixed';
  if (/우리말.*빈칸|한글.*빈칸|korean.*blank/.test(text)) return 'korean_blank';
  if (/영문.*빈칸|영어.*빈칸|english.*blank/.test(text)) return 'english_blank';
  if (/해석|translation/.test(text)) return 'translation';
  if (/동사|verb.*form|어형/.test(text)) return 'verb_form';
  if (/어법|어휘|grammar|vocab|choice|선택/.test(text)) return 'grammar_vocab_choice';
  if (/오류|고쳐|error|correction/.test(text)) return 'error_correction';
  if (/문장.*(순서|배열)|sentence.*order/.test(text)) return 'sentence_ordering';
  if (/영작|writing|write.*sentence/.test(text)) return 'writing';
  return 'unknown';
}

function sentenceLines(text) {
  return clean(text, 80_000).split(/\r?\n/).map(line => clean(line.replace(/^\s*(?:\d+[.)]|[-•])\s*/, ''))).filter(Boolean);
}
function isEnglish(line) { return words(line).length >= 2 && !/[가-힣]/.test(line); }
function isKorean(line) { return /[가-힣]/.test(line) && koWords(line).length >= 1; }
function englishSentences(text) {
  return clean(text, 80_000).replace(/\r?\n+/g, ' ').match(/[^.!?]+(?:[.!?]+|$)/g)?.map(value => clean(value)).filter(isEnglish) || [];
}
function koreanSentences(text) {
  return clean(text, 80_000).replace(/\r?\n+/g, ' ').match(/[^.!?。]+(?:[.!?。]+|$)/g)?.map(value => clean(value)).filter(isKorean) || [];
}

export function extractSentenceRows(text) {
  const rawLines = clean(text, 80_000).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const tsvLines = rawLines.filter(line => line.includes('\t'));
  if (tsvLines.length) {
    if (tsvLines.length !== rawLines.length) return { rows: [], needsTranslation: false, pairing: 'invalid_mixed_tsv' };
    const parsed = tsvLines.map(line => line.split('\t').map(value => clean(value))).filter((columns, index) => !(index === 0 && /^(english|영문|영어)$/i.test(columns[0]) && /^(korean|translation|해석|한국어)$/i.test(columns[1])));
    if (parsed.length && parsed.every(columns => columns.length === 2 && isEnglish(columns[0]) && isKorean(columns[1]))) return { rows: parsed.map(([sentence, translation]) => ({ text: sentence, translation })), needsTranslation: false, pairing: 'tsv_two_column' };
    return { rows: [], needsTranslation: false, pairing: 'invalid_tsv' };
  }
  const lines = sentenceLines(text), rows = [];
  if (lines.length % 2 === 0) for (let index = 0; index < lines.length; index += 2) {
    if (!isEnglish(lines[index]) || !isKorean(lines[index + 1])) { rows.length = 0; break; }
    rows.push({ text: lines[index], translation: lines[index + 1] });
  }
  if (rows.length) return { rows, needsTranslation: false, pairing: 'alternating_lines' };
  const en = englishSentences(text), ko = koreanSentences(text);
  if (en.length && en.length === ko.length) return { rows: en.map((sentence, index) => ({ text: sentence, translation: ko[index] })), needsTranslation: false, pairing: 'matched_sentence_count' };
  if (en.length) return { rows: en.map(sentence => ({ text: sentence, translation: '' })), needsTranslation: true, pairing: 'english_only' };
  return { rows: [], needsTranslation: false, pairing: 'none' };
}

function pageBlocks(text) {
  const lines = clean(text, 80_000).split(/\r?\n/).map(line => clean(line)).filter(Boolean), blocks = [], headings = [];
  let current = { title: '', body: [], page: 1 };
  for (const line of lines) {
    const page = line.match(/^\[?page\s*(\d+)\]?$/i);
    if (page) { current.page = Number(page[1]); continue; }
    const type = semanticWorkbookType(line);
    if (type !== 'unknown') {
      if (current.title || current.body.length) blocks.push(current);
      current = { title: line, body: [], page: current.page }; headings.push({ title: line, type, page: current.page });
    } else current.body.push(line);
  }
  if (current.title || current.body.length) blocks.push(current);
  return { blocks, headings };
}
function numberedPairs(lines) {
  const out = [];
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)[.)]\s*(.+)$/);
    if (!match) continue;
    const source = clean(match[2]), divider = source.match(/^(.*?)\s*(?:\|\||\[?answer:?|정답[:：])\s*([^\]\n]+)\]?$/i);
    out.push({ number: Number(match[1]), prompt: clean(divider?.[1] || source), answer: clean(divider?.[2] || '') });
  }
  return out;
}

function workbookStagePages(text, stage) {
  return clean(text, 80_000).split(/(?=\[PAGE\s+\d+\])/i).filter(page => !/Answer\s*Key/i.test(page) && new RegExp(`워크북\\s*${stage}(?:\\D|$)`).test(page));
}
function pairedNumberedRows(text, stage) {
  const value = workbookStagePages(text, stage).join('\n'), starts = [...value.matchAll(/(?:^|\n)(\d+)\.\s*/g)], rows = [];
  for (let index = 0; index < starts.length; index += 1) {
    const number = Number(starts[index][1]), from = starts[index].index + starts[index][0].length, to = index + 1 < starts.length ? starts[index + 1].index : value.length, block = value.slice(from, to), marker = block.match(new RegExp(`${number}\\)\\s*`));
    if (!marker) continue;
    const source = clean(block.slice(0, marker.index).replace(/\[PAGE\s+\d+\][\s\S]*$/i, '')).replace(/\s+/g, ' '), prompt = clean(block.slice(marker.index + marker[0].length).replace(/\[PAGE\s+\d+\][\s\S]*$/i, '')).replace(/\s+/g, ' ');
    if (source) rows.push({ number, source, prompt });
  }
  return rows;
}
function canonicalWorkbookRows(text) {
  const english = pairedNumberedRows(text, 2), korean = pairedNumberedRows(text, 3), koreanByNumber = new Map(korean.map(row => [row.number, row.source]));
  if (!english.length || english.length !== korean.length || english.some((row, index) => row.number !== index + 1 || !isEnglish(row.source) || !isKorean(koreanByNumber.get(row.number)))) return [];
  return english.map(row => ({ text: row.source, translation: koreanByNumber.get(row.number) }));
}
function answerStageRows(text, stage, expectedCount) {
  const answerAt = text.search(/Answer\s*Key/i); if (answerAt < 0) return [];
  const answerText = text.slice(answerAt), headings = [...answerText.matchAll(/워크북\s*([2-9])[^\n]*/g)], candidates = [];
  for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
    if (Number(headings[headingIndex][1]) !== stage) continue;
    const from = headings[headingIndex].index + headings[headingIndex][0].length, to = headingIndex + 1 < headings.length ? headings[headingIndex + 1].index : answerText.length, section = answerText.slice(from, to), starts = [...section.matchAll(/(?:^|\n)(\d+)\)\s*/g)], rows = [];
    for (let index = 0; index < starts.length; index += 1) {
      const number = Number(starts[index][1]), start = starts[index].index + starts[index][0].length, end = index + 1 < starts.length ? starts[index + 1].index : section.length, answer = clean(section.slice(start, end).replace(/\[PAGE\s+\d+\][\s\S]*$/i, '')).replace(/\s+/g, ' ');
      if (answer) rows.push({ number, answer });
    }
    if (rows.length === expectedCount && rows.every((row, index) => row.number === index + 1)) candidates.push(rows);
  }
  return candidates.length === 1 ? candidates[0] : [];
}
function publisherGrammarExercises(text, rows) {
  const exercises = [];
  for (const stage of [5, 6]) {
    const sources = pairedNumberedRows(text, stage), answers = answerStageRows(text, stage, sources.length), answerByNumber = new Map(answers.map(row => [row.number, row.answer]));
    if (!sources.length || answers.length !== sources.length || sources.length !== rows.length) continue;
    for (const source of sources) {
      const canonical = clean(rows[source.number - 1]?.text), publisherAnswers = answerByNumber.get(source.number)?.split('/').map(value => clean(value)).filter(Boolean) || [];
      if (!canonical || !publisherAnswers.length) continue;
      if (stage === 5) {
        const hints = [...source.prompt.matchAll(/\(([^()]*)\)/g)].map(match => clean(match[1])), prompt = clean(source.prompt.replace(/\([^()]*\)/g, '______________'));
        if (hints.length === publisherAnswers.length && sameEnglish(restoreBlanks(prompt, publisherAnswers), canonical)) exercises.push({ type: 'verb_form', number: source.number, prompt, hints, answers: publisherAnswers, answer: publisherAnswers.join(' / '), page: null, label: '워크북 5 동사형 연습', provenance: { origin: 'publisher_answer_key' } });
      } else {
        const groups = [...source.prompt.matchAll(/\[([^\[\]]+)\]/g)].map(match => match[1].split('/').map(value => clean(value)).filter(Boolean)); let group = 0;
        const prompt = clean(source.prompt.replace(/\[[^\[\]]+\]/g, () => `⟦CHOICE:${group++}⟧`));
        if (groups.length === publisherAnswers.length && groups.every((options, index) => options.includes(publisherAnswers[index]))) { let rebuilt = prompt; publisherAnswers.forEach((answer, index) => { rebuilt = rebuilt.replace(`⟦CHOICE:${index}⟧`, answer); }); if (sameEnglish(rebuilt, canonical)) exercises.push({ type: 'grammar_vocab_choice', number: source.number, prompt, groups, answers: publisherAnswers, answer: publisherAnswers.join(' / '), page: null, label: '워크북 6 어법 선택형 연습', provenance: { origin: 'publisher_answer_key' } }); }
      }
    }
  }
  return exercises;
}

// A full publisher workbook remains review_required until numbered bilingual
// source rows and every grammar stage required for publication are backed by
// exact answer-key round trips. Nothing is inferred from page coordinates.
export function inspectFullWorkbookText(text) {
  const { blocks, headings } = pageBlocks(text), semantic = headings.map(item => item.type);
  const answerKey = /answer\s*key|정답\s*(및|표|해설)?/i.test(text);
  const fullWorkbook = answerKey && new Set(semantic.filter(type => !['unknown', 'check_mixed', 'paragraph_ordering'].includes(type))).size >= 3;
  const translationBlocks = blocks.filter(block => semanticWorkbookType(block.title) === 'translation');
  const candidate = translationBlocks.flatMap(block => numberedPairs(block.body));
  const stageFourPairs = candidate.filter(item => isEnglish(item.prompt) && isKorean(item.answer)).map(item => ({ text: item.prompt, translation: item.answer }));
  const prose = clean(text, 80_000).split(/\r?\n/).filter(line => !/^\s*\d+[.)]/.test(line) && semanticWorkbookType(line) === 'unknown' && !/answer\s*key|정답\s*(및|표|해설)?/i.test(line)).join('\n');
  const extracted = extractSentenceRows(prose), canonicalRows = canonicalWorkbookRows(text), rows = canonicalRows.length ? canonicalRows : stageFourPairs.length ? stageFourPairs : extracted.rows;
  const inlineExercises = blocks.flatMap(block => numberedPairs(block.body).map(item => ({ ...item, type: semanticWorkbookType(block.title), page: block.page, label: block.title }))), publisherExercises = canonicalRows.length ? publisherGrammarExercises(text, rows) : [], exercises = [...publisherExercises, ...inlineExercises], answeredExercises = exercises.filter(item => clean(item.answer) || (Array.isArray(item.answers) && item.answers.length));
  const confident = fullWorkbook && rows.length >= 2 && (canonicalRows.length === rows.length || stageFourPairs.length === rows.length) && [5, 6, 7].every(stage => answeredExercises.some(item => sourceStage(item.type) === stage));
  return {
    fullWorkbook, reviewRequired: !confident, rows, headings,
    exercises,
    incompleteStages: [5, 6, 7].filter(stage => !answeredExercises.some(item => sourceStage(item.type) === stage)),
    reason: confident ? 'numbered bilingual source and answer-key evidence agree' : 'human review required: canonical pairs or publisher answer links are incomplete',
  };
}

function replaceOne(value, answer) { const at = value.indexOf(answer); return at < 0 ? null : `${value.slice(0, at)}______________${value.slice(at + answer.length)}`; }
function restoreBlank(value, answer) { return clean(value).replace(/_{5,}/, answer); }
function restoreBlanks(value, answers) { let index = 0; return clean(value).replace(/_{5,}/g, () => clean(answers?.[index++])); }
function chooseEnglish(sentence) { return words(sentence).filter(word => word.length >= 4).sort((a, b) => b.length - a.length)[0] || words(sentence)[0] || ''; }
function chooseKorean(sentence) { return koWords(sentence).filter(word => word.length >= 2).sort((a, b) => b.length - a.length)[0] || koWords(sentence)[0] || ''; }
function orderTokens(sentence) { const tokens = words(sentence); return tokens.length >= 2 ? tokens : []; }
function item(stage, number, key, fields) { return { key, stage, number, ...fields }; }
function factoryKey(prefix, stage, number) { return `${prefix}-s${stage}-${String(number).padStart(2, '0')}`; }

function deterministicItems(rows, prefix) {
  const byStage = new Map(FACTORY_STAGES.map(stage => [stage, []]));
  rows.forEach((row, index) => {
    const number = index + 1, en = clean(row.text), ko = clean(row.translation), english = chooseEnglish(en), korean = chooseKorean(ko);
    const enBlank = replaceOne(en, english), koBlank = replaceOne(ko, korean), ordered = orderTokens(en);
    if (koBlank && korean) byStage.get(2).push(item(2, number, factoryKey(prefix, 2, number), { kind: 'blank_input', source: en, prompt: koBlank, answers: [korean] }));
    if (enBlank && english) byStage.get(3).push(item(3, number, factoryKey(prefix, 3, number), { kind: 'blank_input', source: ko, prompt: enBlank, answers: [english] }));
    byStage.get(4).push(item(4, number, factoryKey(prefix, 4, number), { kind: 'translation_ai', source: en, prompt: '우리말 해석을 입력하세요.', answers: [ko] }));
    if (ordered.length) {
      const shuffled = [...ordered.slice(1), ordered[0]];
      byStage.get(8).push(item(8, number, factoryKey(prefix, 8, number), { kind: 'reorder_groups', source: ko, prompt: '⟦ORDER:0⟧.', groups: [shuffled], answers: [ordered.join(' ').toLowerCase()] }));
    }
    const writingWords = words(en);
    if (writingWords.length) byStage.get(9).push(item(9, number, factoryKey(prefix, 9, number), { kind: 'blank_input', source: ko, prompt: writingWords.map(() => '______________').join(' '), wordBank: [...new Set(writingWords.map(word => word.toLowerCase()))], answers: writingWords }));
  });
  return byStage;
}

function sourceStage(type) { return ({ korean_blank: 2, english_blank: 3, translation: 4, verb_form: 5, grammar_vocab_choice: 6, error_correction: 7, sentence_ordering: 8, writing: 9 })[type] || 0; }
function sourceChoice(prompt, answer) {
  const match = clean(prompt).match(/\(([^()]{3,240})\)/); if (!match) return null;
  const options = match[1].split(/\s*(?:\/|\||,|or)\s*/i).map(value => clean(value)).filter(Boolean);
  if (options.length < 2 || !options.includes(answer)) return null;
  return { prompt: prompt.replace(match[0], '⟦CHOICE:0⟧'), options };
}
function sourceCorrection(prompt, answer) {
  const pair = clean(answer).match(/^(.+?)\s*(?:→|->|⇒)\s*(.+)$/); if (!pair) return null;
  const wrong = clean(pair[1]), correct = clean(pair[2]);
  return wrong && correct && wrong !== correct ? { wrong, correct, prompt: clean(prompt) } : null;
}
function sourceCorrections(source) {
  const explicit = Array.isArray(source?.answers) ? source.answers.map(value => clean(value, 300)).filter(Boolean) : [];
  if (explicit.length >= 2 && explicit.length % 2 === 0 && explicit.every(value => !/(?:→|->|⇒)/.test(value))) return explicit;
  const pairs = clean(source?.answer, 2_000).split(/\s*(?:\/|;|\|)\s*/).map(value => sourceCorrection('', value)).filter(Boolean);
  return pairs.flatMap(pair => [pair.wrong, pair.correct]);
}
function replaceCorrectionPairs(prompt, answers) {
  let rebuilt = clean(prompt, 6_000);
  for (let index = 0; index < answers.length; index += 2) rebuilt = rebuilt.replace(answers[index], answers[index + 1]);
  return rebuilt;
}
function matchesCanonicalSpan(value, rows) {
  for (let start = 0; start < rows.length; start += 1) {
    let span = '';
    for (let end = start; end < rows.length; end += 1) {
      span = `${span} ${clean(rows[end]?.text)}`.trim();
      if (sameEnglish(value, span)) return true;
    }
  }
  return false;
}
function fullWorkbookItems(sourceExercises, rows, prefix) {
  const byStage = new Map([5, 6, 7].map(stage => [stage, []]));
  for (const source of Array.isArray(sourceExercises) ? sourceExercises : []) {
    const stage = sourceStage(source?.type), number = Number(source?.number), row = rows[number - 1], prompt = clean(source?.prompt, 6_000), answer = clean(source?.answer, 2_000), answers = Array.isArray(source?.answers) ? source.answers.map(value => clean(value, 300)).filter(Boolean) : answer.split('/').map(value => clean(value, 300)).filter(Boolean);
    if (![5, 6, 7].includes(stage) || !number || !prompt || (!answers.length && stage !== 7) || (!row && stage !== 7)) continue;
    const key = factoryKey(prefix, stage, number), en = clean(row?.text), ko = clean(row?.translation);
    if (stage === 5 && sameEnglish(restoreBlanks(prompt, answers), en)) { const hints = Array.isArray(source?.hints) && source.hints.length === answers.length ? source.hints.map(value => clean(value, 120)) : answers; byStage.get(5).push(item(5, number, key, { kind: 'verb_form', source: ko, prompt, hints, answers, provenance: source.provenance })); }
    if (stage === 6) {
      const groups = Array.isArray(source?.groups) ? source.groups.map(group => Array.isArray(group) ? group.map(value => clean(value, 160)).filter(Boolean) : []) : [];
      if (groups.length === answers.length && groups.every((group, index) => group.length >= 2 && group.includes(answers[index]))) {
        let rebuilt = prompt;
        answers.forEach((value, index) => { rebuilt = rebuilt.replace(`⟦CHOICE:${index}⟧`, value); });
        if (sameEnglish(rebuilt, en)) byStage.get(6).push(item(6, number, key, { kind: 'choice_groups', source: ko, prompt, groups, answers, provenance: source.provenance }));
      } else if (answers.length === 1) {
        const choice = sourceChoice(prompt, answers[0]);
        if (choice && sameEnglish(choice.prompt.replace('⟦CHOICE:0⟧', answers[0]), en)) byStage.get(6).push(item(6, number, key, { kind: 'choice_groups', source: ko, prompt: choice.prompt, groups: [choice.options], answers, provenance: source.provenance }));
      }
    }
    if (stage === 7) { const pairs = sourceCorrections(source); if (pairs.length >= 2 && pairs.length % 2 === 0 && matchesCanonicalSpan(replaceCorrectionPairs(prompt, pairs), rows)) byStage.get(7).push(item(7, number, key, { kind: 'correction_pairs', source: '', prompt, pairCount: pairs.length / 2, subtype: pairs.length > 2 ? 'passage' : 'sentence', answers: pairs, provenance: source.provenance })); }
  }
  return byStage;
}

function normalizeAiItem(stage, raw, rows, prefix, number) {
  const sentenceIndex = Number(raw?.sentenceIndex) - 1, row = rows[sentenceIndex]; if (!row) return null;
  const canonicalNumber = sentenceIndex + 1, en = clean(row.text), ko = clean(row.translation), key = factoryKey(prefix, stage, canonicalNumber);
  if (stage === 5) {
    const answer = clean(raw?.answer, 160), prompt = clean(raw?.prompt, 2000), hint = clean(raw?.hint, 120);
    return answer && hint && prompt && restoreBlank(prompt, answer) === en ? item(5, canonicalNumber, key, { kind: 'verb_form', source: ko, prompt, hints: [hint], answers: [answer] }) : null;
  }
  if (stage === 6) {
    const answer = clean(raw?.answer, 160), wrong = clean(raw?.wrong, 160), prompt = clean(raw?.prompt, 2000);
    return answer && wrong && answer !== wrong && prompt && sameEnglish(restoreBlank(prompt, answer), en) ? item(6, canonicalNumber, key, { kind: 'choice_groups', source: ko, prompt: prompt.replace(/_{5,}/, '⟦CHOICE:0⟧'), groups: [[wrong, answer]], answers: [answer] }) : null;
  }
  if (stage === 7) {
    const wrong = clean(raw?.wrong, 160), correct = clean(raw?.correct, 160), sentence = clean(raw?.sentence, 2000);
    if (!wrong || !correct || wrong === correct) return null;
    const faulty = sentence.includes(wrong) && sameEnglish(sentence.replace(wrong, correct), en) ? sentence : en.includes(correct) ? en.replace(correct, wrong) : '';
    return faulty && faulty.includes(wrong) && sameEnglish(faulty.replace(wrong, correct), en) ? item(7, canonicalNumber, key, { kind: 'correction_pairs', source: '', prompt: faulty, pairCount: 1, subtype: 'sentence', answers: [wrong, correct] }) : null;
  }
  return null;
}

function validateItem(stage, candidate, rowByNumber, canonicalRows) {
  if (stage === 7) return candidate.kind === 'correction_pairs' && candidate.answers?.length >= 2 && candidate.answers.length % 2 === 0 && candidate.pairCount * 2 === candidate.answers.length && matchesCanonicalSpan(replaceCorrectionPairs(candidate.prompt, candidate.answers), canonicalRows) ? '' : 'stage7_round_trip';
  const row = rowByNumber.get(candidate.number); if (!row) return 'missing_canonical_sentence';
  const en = clean(row.text), ko = clean(row.translation);
  if (stage === 2) return candidate.answers?.length === 1 && candidate.source === en && restoreBlank(candidate.prompt, candidate.answers[0]) === ko ? '' : 'stage2_round_trip';
  if (stage === 3) return candidate.answers?.length === 1 && candidate.source === ko && restoreBlank(candidate.prompt, candidate.answers[0]) === en ? '' : 'stage3_round_trip';
  if (stage === 4) return candidate.kind === 'translation_ai' && candidate.source === en && candidate.answers?.[0] === ko ? '' : 'stage4_reference';
  if (stage === 5) return candidate.kind === 'verb_form' && candidate.answers?.length >= 1 && candidate.hints?.length === candidate.answers.length && sameEnglish(restoreBlanks(candidate.prompt, candidate.answers), en) ? '' : 'stage5_round_trip';
  if (stage === 6) {
    const answers = candidate.answers || [], groups = candidate.groups || [];
    let rebuilt = clean(candidate.prompt);
    answers.forEach((answer, index) => { rebuilt = rebuilt.replace(`⟦CHOICE:${index}⟧`, answer); });
    return candidate.kind === 'choice_groups' && answers.length >= 1 && groups.length === answers.length && groups.every((group, index) => group.includes(answers[index])) && sameEnglish(rebuilt, en) ? '' : 'stage6_round_trip';
  }
  if (stage === 8) return candidate.kind === 'reorder_groups' && candidate.answers?.[0] && fold(candidate.answers[0]) === fold(words(en).join(' ')) ? '' : 'stage8_round_trip';
  if (stage === 9) return candidate.kind === 'blank_input' && fold(candidate.answers?.join(' ')) === fold(words(en).join(' ')) ? '' : 'stage9_reference';
  return 'unsupported_stage';
}

export function factoryFallbackTargets(catalog, rows, sourceExercises = []) {
  const allNumbers = (Array.isArray(rows) ? rows : []).map((_row, index) => index + 1), stageItems = stage => catalog?.stages?.find(entry => entry.stage === stage)?.items || [];
  const publisherStage7 = (Array.isArray(sourceExercises) ? sourceExercises : []).some(source => sourceStage(source?.type) === 7 && clean(source?.prompt) && (clean(source?.answer) || (Array.isArray(source?.answers) && source.answers.length)));
  return {
    5: allNumbers.filter(number => !stageItems(5).some(item => item.number === number)),
    6: allNumbers.filter(number => !stageItems(6).some(item => item.number === number)),
    7: publisherStage7 ? [] : allNumbers.filter(number => !stageItems(7).some(item => item.number === number)),
  };
}

export function generateWorkbookCatalog({ title, workbookKey, rows, ai = {}, sourceExercises = [], provenance = {} }) {
  const started = Date.now(), canonical = rows.map((row, index) => ({ text: clean(row?.text), translation: clean(row?.translation), index: index + 1 })).filter(row => row.text && row.translation);
  if (!canonical.length || canonical.length !== rows.length) throw new Error('Canonical English/Korean sentence pairs are required.');
  const prefix = clean(workbookKey, 100).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'factory';
  const generated = deterministicItems(canonical, prefix), rowByNumber = new Map(canonical.map(row => [row.index, row])), drops = [];
  const sourceItems = fullWorkbookItems(sourceExercises, canonical, prefix);
  for (const stage of [5, 6, 7]) generated.set(stage, [...sourceItems.get(stage)]);
  for (const stage of [5, 6, 7]) { const sourceNumbers = new Set(sourceItems.get(stage).map(candidate => candidate.number)); (Array.isArray(ai[stage]) ? ai[stage] : []).forEach((raw, index) => {
    const candidate = normalizeAiItem(stage, raw, canonical, prefix, index + 1); if (candidate && !sourceNumbers.has(candidate.number)) generated.get(stage).push(candidate); else if (!candidate) drops.push({ stage, number: Number(raw?.sentenceIndex) || index + 1, reason: `stage${stage}_round_trip` });
  });
  }
  const stages = FACTORY_STAGES.map(stage => {
    const valid = [];
    for (const candidate of generated.get(stage) || []) { const reason = validateItem(stage, candidate, rowByNumber, canonical); if (reason) drops.push({ stage, number: candidate.number, reason }); else valid.push(candidate); }
    const [stageTitle, instruction] = stageMeta[stage]; return { stage, title: stageTitle, instruction, items: valid };
  });
  const count = stage => stages.find(item => item.stage === stage)?.items.length || 0;
  const sourceReusedExercises = [5, 6, 7].reduce((sum, stage) => sum + stages.find(item => item.stage === stage).items.filter(candidate => candidate.provenance).length, 0);
  const publisherStage7Count = sourceExercises.filter(source => sourceStage(source?.type) === 7 && clean(source?.prompt) && (clean(source?.answer) || (Array.isArray(source?.answers) && source.answers.length))).length;
  const stageCoverage = Object.fromEntries(FACTORY_STAGES.map(stage => [stage, { ready: count(stage), expected: stage === 7 && publisherStage7Count ? publisherStage7Count : canonical.length }]));
  const incompleteStages = [5, 6, 7].filter(stage => stageCoverage[stage].ready < stageCoverage[stage].expected);
  const metrics = { elapsedMs: Date.now() - started, sentenceCount: canonical.length, stageCoverage, incompleteStages, pdfExtractedExercises: Number(provenance.pdfExtractedExercises) || 0, sourceReusedExercises, deterministicGeneratedExercises: [2, 3, 4, 8, 9].reduce((sum, stage) => sum + count(stage), 0), geminiGeneratedExercises: [5, 6, 7].reduce((sum, stage) => sum + stages.find(item => item.stage === stage).items.filter(candidate => !candidate.provenance).length, 0), geminiCallCount: Number(provenance.geminiCallCount) || 0, geminiTokenUsage: Number(provenance.geminiTokenUsage) || 0, validatorPass: stages.reduce((sum, stage) => sum + stage.items.length, 0), validatorDrop: drops.length, dropReasons: drops.reduce((all, drop) => ({ ...all, [drop.reason]: (all[drop.reason] || 0) + 1 }), {}) };
  return { workbookKey: prefix, title: clean(title, 120) || 'READY Workbook', source: provenance, importReport: { factory: true, metrics, drops }, stages, metrics };
}
