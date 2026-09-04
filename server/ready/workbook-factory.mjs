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
const fold = value => canonicalText(value).toLowerCase();
const comparableEnglish = value => fold(value)
  .replace(/\b(i)'m\b/g, '$1 am')
  .replace(/\b(you|we|they)'re\b/g, '$1 are')
  .replace(/\b(he|she|it)'s\b/g, '$1 is')
  .replace(/\blet's\b/g, 'let us')
  .replace(/\b([a-z]+)n't\b/g, (_, word) => word === 'ca' ? 'cannot' : word === 'wo' ? 'will not' : `${word} not`)
  .replace(/\b([a-z]+)'ve\b/g, '$1 have')
  .replace(/\b([a-z]+)'ll\b/g, '$1 will')
  .replace(/\b([a-z]+)'d\b/g, '$1 would')
  .replace(/\s+/g, ' ');
const sameEnglish = (left, right) => comparableEnglish(left) === comparableEnglish(right);
const sameOption = (left, right) => fold(left) === fold(right);
const words = value => clean(value).match(/[A-Za-z]+(?:[’'][A-Za-z]+)*/g) || [];
const koWords = value => clean(value).match(/[가-힣]+(?:[·ㆍ][가-힣]+)*/g) || [];
export const SEMANTIC_WORKBOOK_CONTRACT = 'semantic-v2';
const stageMeta = {
  1: ['1단계 · 우리말 빈칸', '영문을 보고 우리말 해석의 빈칸을 완성하세요.', 'korean_blank'],
  2: ['2단계 · 영어 빈칸', '우리말 해석을 보고 영문의 빈칸을 완성하세요.', 'english_blank'],
  3: ['3단계 · 해석', '영문을 자연스러운 우리말로 해석하세요.', 'translation'],
  4: ['4단계 · 동사형', '주어진 동사를 문장에 맞는 형태로 고쳐 쓰세요.', 'verb_form'],
  5: ['5단계 · 어법 선택', '각 구간에서 알맞은 표현을 고르세요.', 'grammar_choice'],
  6: ['6단계 · 어순 배열', '주어진 단어를 문장 순서로 배열하세요.', 'word_order'],
  7: ['7단계 · 영작', '우리말 뜻을 보고 영어 문장 전체를 직접 쓰세요.', 'writing'],
};

export const FACTORY_STAGES = Object.freeze([1, 2, 3, 4, 5, 6, 7]);

export function semanticWorkbookType(label) {
  const text = fold(label);
  if (/paragraph|문단\s*(순서|배열)|단락\s*(순서|배열)/.test(text)) return 'paragraph_ordering';
  if (/check|mixed|종합\s*(문제|평가)|확인\s*문제/.test(text)) return 'check_mixed';
  if (/지문\s*(읽기|학습)|passage\s*(read|study)|reading[- ]?only/.test(text)) return 'reading_only';
  if (/우리말.*빈칸|한글.*빈칸|korean.*blank/.test(text)) return 'korean_blank';
  if (/영문.*빈칸|영어.*빈칸|english.*blank/.test(text)) return 'english_blank';
  if (/해석|translation/.test(text)) return 'translation';
  if (/동사|verb.*form|어형/.test(text)) return 'verb_form';
  if (/오류|고쳐|error|correction/.test(text)) return 'error_correction';
  if (/문장.*(순서|배열)|순서\s*배열|sentence.*order|word.*order/.test(text)) return 'word_order';
  if (/영작|writing|write.*sentence/.test(text)) return 'writing';
  if (/어법|어휘|grammar|vocab|choice|선택/.test(text)) return 'grammar_choice';
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
function parsedPairedNumberedRows(text, stage) {
  const value = workbookStagePages(text, stage).join('\n'), starts = [...value.matchAll(/(?:^|\n)(\d+)\.\s*/g)], rows = [];
  for (let index = 0; index < starts.length; index += 1) {
    const number = Number(starts[index][1]), from = starts[index].index + starts[index][0].length, to = index + 1 < starts.length ? starts[index + 1].index : value.length, block = value.slice(from, to), marker = block.match(new RegExp(`${number}\\)\\s*`));
    if (!marker) continue;
    const source = clean(block.slice(0, marker.index).replace(/\[PAGE\s+\d+\][\s\S]*$/i, '')).replace(/\s+/g, ' '), prompt = clean(block.slice(marker.index + marker[0].length).replace(/\[PAGE\s+\d+\][\s\S]*$/i, '')).replace(/\s+/g, ' ');
    if (source) rows.push({ number, source, prompt });
  }
  return rows;
}
function splitSequentialRows(rows) {
  const sets = []; let current = [];
  for (const row of rows) {
    if (row.number === 1 && current.length) { sets.push(current); current = []; }
    const expected = current.length + 1;
    if (row.number !== expected) { if (current.length) sets.push(current); current = row.number === 1 ? [row] : []; }
    else current.push(row);
  }
  if (current.length) sets.push(current);
  return sets;
}
function pairedNumberedRowSets(text, stage) { return splitSequentialRows(parsedPairedNumberedRows(text, stage)); }
function pairedNumberedRows(text, stage) {
  const sets = pairedNumberedRowSets(text, stage);
  return sets.length === 1 ? sets[0] : sets.flat();
}
function canonicalWorkbookRowSets(text) {
  const englishSets = pairedNumberedRowSets(text, 2), koreanSets = pairedNumberedRowSets(text, 3), candidates = [];
  for (const english of englishSets) for (const korean of koreanSets) {
    if (!english.length || english.length !== korean.length) continue;
    const koreanByNumber = new Map(korean.map(row => [row.number, row.source]));
    if (english.some((row, index) => row.number !== index + 1 || !isEnglish(row.source) || !isKorean(koreanByNumber.get(row.number)))) continue;
    candidates.push(english.map(row => ({ text: row.source, translation: koreanByNumber.get(row.number) })));
  }
  return candidates;
}
function chooseCanonicalWorkbookRows(text, expectedRows) {
  const candidates = canonicalWorkbookRowSets(text), expected = Array.isArray(expectedRows) ? expectedRows : [];
  if (expected.length) {
    const matched = candidates.filter(rows => compareCanonicalRows(expected, rows).consistent);
    return { rows: matched.length === 1 ? matched[0] : [], candidateCount: candidates.length, matchedCount: matched.length };
  }
  return { rows: candidates.length ? candidates[0] : [], candidateCount: candidates.length, matchedCount: candidates.length === 1 ? 1 : 0 };
}
function answerStageCandidates(text, stage, expectedCount) {
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
  return candidates;
}
function answerStageRows(text, stage, expectedCount) {
  const candidates = answerStageCandidates(text, stage, expectedCount);
  return candidates.length === 1 ? candidates[0] : [];
}
const canonicalSpanIndexCache = new WeakMap();
function canonicalSpanIndex(rows) {
  if (!Array.isArray(rows)) return new Map();
  const cached = canonicalSpanIndexCache.get(rows);
  if (cached) return cached;
  const index = new Map();
  for (let start = 0; start < rows.length; start += 1) {
    let span = '';
    for (let end = start; end < rows.length; end += 1) {
      span = `${span} ${clean(rows[end]?.text)}`.trim();
      const key = comparableEnglish(span), range = { start: start + 1, end: end + 1 }, matches = index.get(key);
      if (matches) matches.push(range); else index.set(key, [range]);
    }
  }
  canonicalSpanIndexCache.set(rows, index);
  return index;
}
function canonicalSpanMatches(value, rows) {
  return canonicalSpanIndex(rows).get(comparableEnglish(value)) || [];
}
function uniqueCanonicalSpan(value, rows) {
  const matches = canonicalSpanMatches(value, rows);
  return matches.length === 1 ? matches[0] : null;
}
function spanText(rows, span, field = 'text') { return span ? rows.slice(span.start - 1, span.end).map(row => clean(row?.[field])).join(' ') : ''; }
function publisherGrammarCandidate(stage, sources, answers, rows) {
  const answerByNumber = new Map(answers.map(row => [row.number, row.answer])), exercises = [];
  for (const source of sources) {
    const publisherAnswers = answerByNumber.get(source.number)?.split('/').map(value => clean(value)).filter(Boolean) || [];
    if (!publisherAnswers.length) return [];
    if (stage === 5) {
      const hints = [...source.prompt.matchAll(/\(([^()]*)\)/g)].map(match => clean(match[1])), prompt = clean(source.prompt.replace(/\([^()]*\)/g, '______________'));
      if (hints.length !== publisherAnswers.length) return [];
      const rebuilt = restoreBlanks(prompt, publisherAnswers), span = uniqueCanonicalSpan(rebuilt, rows);
      if (!span || span.start !== span.end) return [];
      exercises.push({ type: 'verb_form', number: source.number, prompt, hints, answers: publisherAnswers, answer: publisherAnswers.join(' / '), canonicalStart: span.start, canonicalEnd: span.end, page: null, label: '워크북 5 동사형 연습', provenance: { origin: 'publisher_answer_key' } });
      continue;
    }
    const groups = [...source.prompt.matchAll(/\[([^\[\]]+)\]/g)].map(match => match[1].split('/').map(value => clean(value)).filter(Boolean));
    if (groups.length !== publisherAnswers.length || groups.some(group => group.length < 2 || group.some(option => /,/.test(option)))) return [];
    const answersFromOptions = groups.map((group, index) => group.find(option => sameOption(option, publisherAnswers[index])) || '');
    if (answersFromOptions.some(answer => !answer)) return [];
    let group = 0, prompt = clean(source.prompt.replace(/\[[^\[\]]+\]/g, () => `⟦CHOICE:${group++}⟧`)), rebuilt = prompt;
    answersFromOptions.forEach((answer, index) => { rebuilt = rebuilt.replace(`⟦CHOICE:${index}⟧`, answer); });
    const span = uniqueCanonicalSpan(rebuilt, rows);
    if (!span) return [];
    exercises.push({ type: 'grammar_vocab_choice', number: source.number, prompt, groups, answers: answersFromOptions, answer: answersFromOptions.join(' / '), canonicalStart: span.start, canonicalEnd: span.end, page: null, label: '워크북 6 어법 선택형 연습', provenance: { origin: 'publisher_answer_key' } });
  }
  return exercises;
}
function publisherGrammarExercises(text, rows) {
  const exercises = [];
  for (const stage of [5, 6]) {
    const candidates = [];
    for (const sources of pairedNumberedRowSets(text, stage)) for (const answers of answerStageCandidates(text, stage, sources.length)) {
      const parsed = publisherGrammarCandidate(stage, sources, answers, rows);
      if (parsed.length === sources.length) candidates.push(parsed);
    }
    const signatures = new Map(candidates.map(items => [JSON.stringify(items.map(item => [item.number, item.canonicalStart, item.canonicalEnd, item.answers])), items]));
    if (signatures.size === 1) exercises.push(...signatures.values().next().value);
  }
  return exercises;
}
function stage7PromptItems(text) {
  const value = workbookStagePages(text, 7).join('\n'), starts = [...value.matchAll(/(?:^|\n)\s*(\d+)\s+다음 글의 밑줄 친 부분 중\s*(문맥상|어법상)\s*어색한 것을\s*(?:두|세|네|\d+)\s*개 찾아 바르게 고쳐 쓰시오\.\s*(?:\d+\))?\s*/g)], output = [];
  let section = 0;
  for (let index = 0; index < starts.length; index += 1) {
    const number = Number(starts[index][1]), family = starts[index][2] === '문맥상' ? 'context' : 'grammar';
    if (family === 'context' && number === 1 && output.some(item => item.section === section && item.family === 'grammar')) section += 1;
    const from = starts[index].index + starts[index][0].length, to = index + 1 < starts.length ? starts[index + 1].index : value.length, block = value.slice(from, to), blank = block.search(/\(1\)\s*_{5,}/), prompt = clean((blank >= 0 ? block.slice(0, blank) : block).replace(/\[PAGE\s+\d+\][\s\S]*$/i, '')).replace(/\s+/g, ' ');
    if (prompt && isEnglish(prompt)) output.push({ family, number, prompt, section });
  }
  return output;
}
function stage7AnswerPart(value) {
  return canonicalText(String(value ?? '')
    .replace(/\[PAGE\s+\d+\]/gi, ' ')
    .replace(/워크북\s*[2-9][^\n]*/g, ' ')
    .replace(/[가-힣]+/g, ' ')
    .replace(/\bLesson\s+\d+\b/gi, ' ')
    .replace(/\bAnswer\s*Key\b/gi, ' ')
    .replace(/[│◗]/g, ' ')
    .replace(/\s+-\s*\d+\s*-\s+/g, ' '));
}
function stage7PairsFromBlock(value) {
  const raw = String(value ?? ''), nextStage = raw.search(/워크북\s*8(?:\D|$)/), bounded = nextStage >= 0 ? raw.slice(0, nextStage) : raw, scoped = bounded.replace(/\[PAGE\s+\d+\][\s\S]*?(?=\(\d+\)\s*)/gi, ' ');
  return [...scoped.matchAll(/\((\d+)\)\s*([\s\S]*?)\s*(?:→|->|⇒)\s*([\s\S]*?)(?=\(\d+\)\s*|$)/g)]
    .map(match => [stage7AnswerPart(match[2]), stage7AnswerPart(match[3])])
    .filter(pair => pair[0] && pair[1] && !sameOption(pair[0], pair[1]));
}
function stage7AnswerItems(text) {
  const answerAt = text.search(/Answer\s*Key/i); if (answerAt < 0) return [];
  const answerText = text.slice(answerAt), output = [];
  const add = (family, number, value) => {
    const pairs = stage7PairsFromBlock(value);
    if (pairs.length >= 2 && pairs.length <= 4) output.push({ family, number, pairs });
  };
  const markers = [...answerText.matchAll(/워크북\s*7\s*어색한 곳 찾기 연습/g)];
  for (const marker of markers) {
    const following = answerText.slice(marker.index + marker[0].length), nextStage = following.search(/워크북\s*8(?:\D|$)/), block = following.slice(0, nextStage >= 0 ? nextStage : following.length), headings = [...block.matchAll(/(문맥상|어법상)\s*어색한 것 찾기/g)];
    for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
      const family = headings[headingIndex][1] === '문맥상' ? 'context' : 'grammar', from = headings[headingIndex].index + headings[headingIndex][0].length, to = headingIndex + 1 < headings.length ? headings[headingIndex + 1].index : block.length, section = block.slice(from, to), starts = [...section.matchAll(/(?:^|\n)\s*(\d+)\)\s*\(1\)\s*/g)];
      for (let index = 0; index < starts.length; index += 1) {
        const number = Number(starts[index][1]), begin = starts[index].index + starts[index][0].length, finish = index + 1 < starts.length ? starts[index + 1].index : section.length;
        add(family, number, `(1) ${section.slice(begin, finish)}`);
      }
    }
  }
  // PDF text layers can emit a continuation column before the repeated
  // "워크북 7" heading on the next answer-key page. Rescue every numbered
  // arrow-pair block globally, then let the canonical round-trip below decide
  // which context/grammar prompt it belongs to. This stays fail-closed.
  const starts = [...answerText.matchAll(/(?:^|\n)\s*(\d+)\)\s*\(1\)\s*/g)];
  for (let index = 0; index < starts.length; index += 1) {
    const number = Number(starts[index][1]), begin = starts[index].index + starts[index][0].length, finish = index + 1 < starts.length ? starts[index + 1].index : answerText.length;
    add('', number, `(1) ${answerText.slice(begin, finish)}`);
  }
  const unique = new Map(output.map(item => [`${item.family}:${item.number}:${JSON.stringify(item.pairs)}`, item]));
  return [...unique.values()];
}
function literalOccurrences(value, needle) {
  const output = [], haystack = String(value), target = String(needle);
  if (!target) return output;
  let at = 0;
  while ((at = haystack.indexOf(target, at)) >= 0) { output.push(at); at += Math.max(1, target.length); }
  if (output.length) return output;
  const lower = haystack.toLowerCase(), lowerTarget = target.toLowerCase(); at = 0;
  while ((at = lower.indexOf(lowerTarget, at)) >= 0) { output.push(at); at += Math.max(1, target.length); }
  return output;
}
function correctionRoundTrip(prompt, flatAnswers, rows) {
  const pairs = [];
  for (let index = 0; index < flatAnswers.length; index += 2) pairs.push([clean(flatAnswers[index]), clean(flatAnswers[index + 1])]);
  if (!pairs.length || pairs.some(pair => !pair[0] || !pair[1])) return null;
  const matches = new Map(), visited = new Set(), visit = (value, pairIndex) => {
    if (matches.size > 1) return;
    const visitKey = `${pairIndex}:${value}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    if (pairIndex === pairs.length) {
      for (const span of canonicalSpanMatches(value, rows)) matches.set(`${span.start}:${span.end}:${canonicalText(value)}`, { value, span });
      return;
    }
    const [wrong, correct] = pairs[pairIndex], positions = literalOccurrences(value, wrong);
    for (const position of positions) visit(`${value.slice(0, position)}${correct}${value.slice(position + wrong.length)}`, pairIndex + 1);
  };
  visit(clean(prompt, 6_000), 0);
  return matches.size === 1 ? matches.values().next().value : null;
}
function minimalCorrectionPair(wrong, correct) {
  const left = clean(wrong).split(/\s+/), right = clean(correct).split(/\s+/), comparable = value => fold(value).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(left.length, right.length) && comparable(left[prefix]) === comparable(right[prefix])) prefix += 1;
  while (suffix < Math.min(left.length - prefix, right.length - prefix) && comparable(left[left.length - 1 - suffix]) === comparable(right[right.length - 1 - suffix])) suffix += 1;
  let leftEnd = suffix ? left.length - suffix : left.length, rightEnd = suffix ? right.length - suffix : right.length;
  if (prefix === leftEnd || prefix === rightEnd) { if (suffix) { leftEnd += 1; rightEnd += 1; } else if (prefix) prefix -= 1; }
  const localized = [clean(left.slice(prefix, leftEnd).join(' ')), clean(right.slice(prefix, rightEnd).join(' '))];
  return localized.every(Boolean) ? localized : [clean(wrong), clean(correct)];
}
function publisherStage7Exercises(text, rows) {
  const prompts = stage7PromptItems(text), answers = stage7AnswerItems(text), resolved = new Map(), selectedSections = new Set();
  for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
    const promptItem = prompts[promptIndex], matches = [];
    for (const answerItem of answers.filter(item => item.number === promptItem.number && (!item.family || item.family === promptItem.family))) {
      const flat = answerItem.pairs.flat(), restored = correctionRoundTrip(promptItem.prompt, flat, rows);
      if (restored) matches.push({ answerItem, restored });
    }
    const signatures = new Map(matches.map(match => [`${match.restored.span.start}:${match.restored.span.end}:${JSON.stringify(match.answerItem.pairs)}`, match]));
    if (signatures.size !== 1) continue;
    resolved.set(promptIndex, signatures.values().next().value);
    selectedSections.add(promptItem.section);
  }
  const exercises = [];
  for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
    const promptItem = prompts[promptIndex];
    if (!selectedSections.has(promptItem.section)) continue;
    const sourceNumber = promptItem.number, number = exercises.length + 1, match = resolved.get(promptIndex);
    if (!match) {
      exercises.push({ type: 'error_correction', number, sourceNumber, subtype: promptItem.family, prompt: promptItem.prompt, answers: [], answer: '', canonicalStart: null, canonicalEnd: null, page: null, label: '워크북 7 어색한 곳 찾기 연습', provenance: { origin: 'publisher_prompt' } });
      continue;
    }
    const publisherPairs = match.answerItem.pairs, localized = publisherPairs.map(pair => minimalCorrectionPair(...pair));
    exercises.push({ type: 'error_correction', number, sourceNumber, subtype: promptItem.family, prompt: promptItem.prompt, answers: localized.flat(), answer: localized.map(pair => `${pair[0]} → ${pair[1]}`).join(' / '), publisherAnswers: publisherPairs.flat(), canonicalStart: match.restored.span.start, canonicalEnd: match.restored.span.end, page: null, label: '워크북 7 어색한 곳 찾기 연습', provenance: { origin: 'publisher_answer_key' } });
  }
  return exercises;
}

// A full publisher workbook remains review_required until numbered bilingual
// source rows and every grammar stage required for publication are backed by
// exact answer-key round trips. Nothing is inferred from page coordinates.
export function inspectFullWorkbookText(text, expectedRows = null) {
  const { blocks, headings } = pageBlocks(text), semantic = headings.map(item => item.type);
  const answerKey = /answer\s*key|정답\s*(및|표|해설)?/i.test(text);
  const fullWorkbook = answerKey && new Set(semantic.filter(type => !['unknown', 'check_mixed', 'paragraph_ordering'].includes(type))).size >= 3;
  const translationBlocks = blocks.filter(block => semanticWorkbookType(block.title) === 'translation');
  const candidate = translationBlocks.flatMap(block => numberedPairs(block.body));
  const stageFourPairs = candidate.filter(item => isEnglish(item.prompt) && isKorean(item.answer)).map(item => ({ text: item.prompt, translation: item.answer }));
  const prose = clean(text, 80_000).split(/\r?\n/).filter(line => !/^\s*\d+[.)]/.test(line) && semanticWorkbookType(line) === 'unknown' && !/answer\s*key|정답\s*(및|표|해설)?/i.test(line)).join('\n');
  const extracted = extractSentenceRows(prose), canonicalSelection = chooseCanonicalWorkbookRows(text, expectedRows), canonicalRows = canonicalSelection.rows, rows = canonicalRows.length ? canonicalRows : stageFourPairs.length ? stageFourPairs : extracted.rows;
  const inlineExercises = blocks.flatMap(block => numberedPairs(block.body).map(item => ({ ...item, type: semanticWorkbookType(block.title), page: block.page, label: block.title, provenance: { origin: 'publisher_answer_key', sourceWorkbookNumber: Number(block.title.match(/(?:workbook|stage|워크북)\s*(\d+)/i)?.[1]) || null } }))), publisherExercises = canonicalRows.length ? publisherGrammarExercises(text, rows) : [], publisherStages = new Set(publisherExercises.map(item => readyStageForSemanticType(item.type)).filter(Boolean)), exercises = [...publisherExercises, ...inlineExercises.filter(item => { const stage = readyStageForSemanticType(item.type); return stage && !publisherStages.has(stage); })], answeredExercises = exercises.filter(item => clean(item.answer) || (Array.isArray(item.answers) && item.answers.length));
  const sectionAmbiguous = !Array.isArray(expectedRows) && canonicalSelection.candidateCount > 1;
  const confident = fullWorkbook && !sectionAmbiguous && rows.length >= 2 && (canonicalRows.length === rows.length || stageFourPairs.length === rows.length) && answeredExercises.every(item => readyStageForSemanticType(item.type) > 0);
  return {
    fullWorkbook, reviewRequired: !confident, rows, headings,
    exercises,
    incompleteStages: [],
    reason: confident ? 'numbered bilingual source and answer-key evidence agree' : sectionAmbiguous ? 'human review required: multiple workbook passage sections found' : 'human review required: canonical pairs or publisher answer links are incomplete',
    pairing: canonicalRows.length ? (canonicalSelection.candidateCount > 1 ? 'publisher_section_match' : 'publisher_numbered') : extracted.pairing,
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
function hashSeed(value) { let hash = 2_166_136_261; for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16_777_619); } return hash >>> 0; }
function seededShuffle(tokens, seed) { const output = [...tokens]; let state = hashSeed(seed); const random = () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4_294_967_296; }; for (let index = output.length - 1; index > 0; index -= 1) { const target = Math.floor(random() * (index + 1)); [output[index], output[target]] = [output[target], output[index]]; } return output; }
function isCyclicRotation(candidate, canonical) { return candidate.length === canonical.length && candidate.some((_value, offset) => candidate.every((value, index) => value === canonical[(index + offset) % canonical.length])); }
function sufficientlyShuffled(candidate, canonical) { return candidate.length >= 3 && !isCyclicRotation(candidate, canonical) && candidate.filter((value, index) => value !== canonical[index]).length >= Math.ceil(canonical.length / 2); }
function factoryOrderBank(tokens, seed) { for (let attempt = 0; attempt < 16; attempt += 1) { const candidate = seededShuffle(tokens, `${seed}:${attempt}`); if (sufficientlyShuffled(candidate, tokens)) return candidate; } return []; }

function emptySemanticStages() { return new Map(FACTORY_STAGES.map(stage => [stage, []])); }

// Printed workbook numbers are provenance only. Correction, paragraph order,
// reading-only and mixed sections deliberately have no active READY stage.
export function readyStageForSemanticType(type) {
  return ({ korean_blank: 1, english_blank: 2, translation: 3, verb_form: 4, grammar_choice: 5, grammar_vocab_choice: 5, word_order: 6, sentence_ordering: 6, writing: 7 })[type] || 0;
}
function sourceChoice(prompt, answer) {
  const match = clean(prompt).match(/(?:\[([^\[\]]{3,240})\]|\(([^()]{3,240})\))/); if (!match) return null;
  const options = clean(match[1] || match[2]).split(/\s*(?:\/|\|)\s*/).map(value => clean(value)).filter(Boolean);
  const selected = options.find(option => sameOption(option, answer));
  if (options.length < 2 || !selected) return null;
  return { prompt: prompt.replace(match[0], '⟦CHOICE:0⟧'), options, answer: selected };
}
function sourceCorrection(prompt, answer) {
  const pair = clean(answer).match(/^(.+?)\s*(?:→|->|⇒)\s*(.+)$/); if (!pair) return null;
  const wrong = clean(pair[1]), correct = clean(pair[2]);
  return wrong && correct && !sameOption(wrong, correct) ? { wrong, correct, prompt: clean(prompt) } : null;
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
function matchesCanonicalSpan(value, rows) { return canonicalSpanMatches(value, rows).length > 0; }
function sourceSpan(source, rebuilt, rows) {
  const start = Number(source?.canonicalStart), end = Number(source?.canonicalEnd);
  if (start >= 1 && end >= start && end <= rows.length && sameEnglish(rebuilt, spanText(rows, { start, end }))) return { start, end };
  return uniqueCanonicalSpan(rebuilt, rows);
}
function fullWorkbookItems(sourceExercises, rows, prefix) {
  const byStage = emptySemanticStages();
  for (const source of Array.isArray(sourceExercises) ? sourceExercises : []) {
    const stage = readyStageForSemanticType(source?.type), number = Number(source?.number), row = rows[number - 1], prompt = clean(source?.prompt, 6_000), answer = clean(source?.answer, 2_000), answers = Array.isArray(source?.answers) ? source.answers.map(value => clean(value, 300)).filter(Boolean) : answer.split('/').map(value => clean(value, 300)).filter(Boolean);
    if (!stage || !number || !row || !prompt || !answers.length) continue;
    const key = factoryKey(prefix, stage, number), en = clean(row.text), ko = clean(row.translation), semanticType = stageMeta[stage][2];
    const provenance = { ...(source.provenance || {}), semanticType, mappedReadyStage: stage, sourceWorkbookNumber: Number(source?.provenance?.sourceWorkbookNumber || source?.provenance?.sourceWorkbookStage) || null };
    if (stage === 1 && restoreBlanks(prompt, answers) === ko) byStage.get(1).push(item(1, number, key, { kind: 'blank_input', semanticType, source: en, prompt, answers, provenance }));
    if (stage === 2 && sameEnglish(restoreBlanks(prompt, answers), en)) byStage.get(2).push(item(2, number, key, { kind: 'blank_input', semanticType, source: ko, prompt, answers, provenance }));
    if (stage === 3 && sameEnglish(prompt, en) && answers.length === 1 && answers[0] === ko) byStage.get(3).push(item(3, number, key, { kind: 'translation_input', semanticType, source: en, prompt: '우리말 해석을 입력하세요.', answers: [ko], provenance }));
    if (stage === 4 && sameEnglish(restoreBlanks(prompt, answers), en)) { const hints = Array.isArray(source?.hints) && source.hints.length === answers.length ? source.hints.map(value => clean(value, 120)) : answers; byStage.get(4).push(item(4, number, key, { kind: 'verb_form', semanticType, source: ko, prompt, hints, answers, provenance })); }
    if (stage === 5) {
      const groups = Array.isArray(source?.groups) ? source.groups.map(group => Array.isArray(group) ? group.map(value => clean(value, 160)).filter(Boolean) : []) : [];
      if (groups.length === answers.length && groups.every((group, index) => group.length >= 2 && group.some(option => sameOption(option, answers[index])))) {
        const selectedAnswers = groups.map((group, index) => group.find(option => sameOption(option, answers[index])) || ''); let rebuilt = prompt;
        selectedAnswers.forEach((value, index) => { rebuilt = rebuilt.replace(`⟦CHOICE:${index}⟧`, value); });
        const span = sourceSpan(source, rebuilt, rows);
        if (span) byStage.get(5).push(item(5, number, key, { kind: 'choice_groups', semanticType, source: spanText(rows, span, 'translation'), prompt, groups, answers: selectedAnswers, canonicalStart: span.start, canonicalEnd: span.end, provenance }));
      } else if (answers.length === 1) {
        const choice = sourceChoice(prompt, answers[0]);
        if (choice) { const rebuilt = choice.prompt.replace('⟦CHOICE:0⟧', choice.answer), span = sourceSpan(source, rebuilt, rows); if (span) byStage.get(5).push(item(5, number, key, { kind: 'choice_groups', semanticType, source: spanText(rows, span, 'translation'), prompt: choice.prompt, groups: [choice.options], answers: [choice.answer], canonicalStart: span.start, canonicalEnd: span.end, provenance })); }
      }
    }
    if (stage === 6) {
      const span = sourceSpan(source, clean(source?.canonicalText) || answer || prompt, rows) || uniqueCanonicalSpan(prompt, rows);
      if (span && span.start === span.end) {
        const tokens = orderTokens(spanText(rows, span)), shuffled = factoryOrderBank(tokens, `${prefix}:${key}:${number}`);
        if (shuffled.length) byStage.get(6).push(item(6, number, key, { kind: 'reorder_groups', semanticType, source: spanText(rows, span, 'translation'), prompt: '⟦ORDER:0⟧.', groups: [shuffled], answers: [tokens.join(' ').toLowerCase()], canonicalStart: span.start, canonicalEnd: span.end, provenance }));
      }
    }
    if (stage === 7) {
      const rebuilt = restoreBlanks(prompt, answers), span = sourceSpan(source, rebuilt, rows) || uniqueCanonicalSpan(answer, rows) || uniqueCanonicalSpan(prompt, rows);
      if (span && span.start === span.end) byStage.get(7).push(item(7, number, key, { kind: 'full_sentence_input', semanticType, source: spanText(rows, span, 'translation'), prompt: '', answers: [spanText(rows, span)], canonicalStart: span.start, canonicalEnd: span.end, provenance }));
    }
  }
  return byStage;
}

export function validateSemanticWorkbookItem(stage, candidate, rowByNumber, canonicalRows) {
  if (candidate?.semanticType !== stageMeta[stage]?.[2]) return 'semantic_type_mismatch';
  if (!candidate?.provenance) return 'source_provenance_missing';
  const row = rowByNumber.get(candidate.number); if (!row && stage !== 6) return 'missing_canonical_sentence';
  const en = clean(row?.text), ko = clean(row?.translation);
  if (stage === 1) return candidate.answers?.length >= 1 && candidate.source === en && restoreBlanks(candidate.prompt, candidate.answers) === ko ? '' : 'stage1_round_trip';
  if (stage === 2) return candidate.answers?.length >= 1 && candidate.source === ko && sameEnglish(restoreBlanks(candidate.prompt, candidate.answers), en) ? '' : 'stage2_round_trip';
  if (stage === 3) return candidate.kind === 'translation_input' && candidate.source === en && candidate.answers?.[0] === ko ? '' : 'stage3_reference';
  if (stage === 4) return candidate.kind === 'verb_form' && candidate.answers?.length >= 1 && candidate.hints?.length === candidate.answers.length && sameEnglish(restoreBlanks(candidate.prompt, candidate.answers), en) ? '' : 'stage4_round_trip';
  if (stage === 5) {
    const answers = candidate.answers || [], groups = candidate.groups || []; let rebuilt = clean(candidate.prompt);
    answers.forEach((answer, index) => { rebuilt = rebuilt.replace(`⟦CHOICE:${index}⟧`, answer); });
    const span = candidate.canonicalStart ? { start: Number(candidate.canonicalStart), end: Number(candidate.canonicalEnd) } : row ? { start: candidate.number, end: candidate.number } : null, canonical = spanText(canonicalRows, span);
    return candidate.kind === 'choice_groups' && answers.length >= 1 && groups.length === answers.length && groups.every((group, index) => group.length >= 2 && group.some(option => sameOption(option, answers[index])) && group.every(option => !/,/.test(option))) && canonical && sameEnglish(rebuilt, canonical) ? '' : 'stage5_round_trip';
  }
  if (stage === 6) {
    const span = { start: Number(candidate.canonicalStart), end: Number(candidate.canonicalEnd) }, canonical = spanText(canonicalRows, span), chips = candidate.groups?.[0] || [];
    return candidate.kind === 'reorder_groups' && span.start === span.end && chips.length >= 2 && chips.every(chip => words(chip).length === 1 && !/\s/.test(clean(chip))) && candidate.answers?.[0] && fold(candidate.answers[0]) === fold(words(canonical).join(' ')) ? '' : 'stage6_word_order';
  }
  if (stage === 7) return candidate.kind === 'full_sentence_input' && !clean(candidate.prompt) && !candidate.wordBank?.length && candidate.answers?.length === 1 && candidate.source === ko && sameEnglish(candidate.answers[0], en) ? '' : 'stage7_whole_sentence';
  return 'unsupported_stage';
}

export function generateWorkbookCatalog({ title, workbookKey, rows, sourceExercises = [], provenance = {} }) {
  const started = Date.now(), canonical = rows.map((row, index) => ({ text: clean(row?.text), translation: clean(row?.translation), index: index + 1 })).filter(row => row.text && row.translation);
  if (!canonical.length || canonical.length !== rows.length) throw new Error('Canonical English/Korean sentence pairs are required.');
  const prefix = clean(workbookKey, 100).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'factory', generated = fullWorkbookItems(sourceExercises, canonical, prefix), rowByNumber = new Map(canonical.map(row => [row.index, row])), drops = [];
  const expected = Object.fromEntries(FACTORY_STAGES.map(stage => [stage, sourceExercises.filter(source => readyStageForSemanticType(source?.type) === stage).length]));
  const stages = FACTORY_STAGES.map(stage => {
    const valid = [];
    for (const candidate of generated.get(stage) || []) { const reason = validateSemanticWorkbookItem(stage, candidate, rowByNumber, canonical); if (reason) drops.push({ stage, number: candidate.number, reason }); else valid.push(candidate); }
    const [stageTitle, instruction, semanticType] = stageMeta[stage]; return { stage, semanticType, title: stageTitle, instruction, items: valid };
  });
  const count = stage => stages.find(item => item.stage === stage)?.items.length || 0, stageCoverage = Object.fromEntries(FACTORY_STAGES.map(stage => [stage, { ready: count(stage), expected: expected[stage] }])), incompleteStages = FACTORY_STAGES.filter(stage => stageCoverage[stage].ready < stageCoverage[stage].expected);
  const unresolved = drops.length + FACTORY_STAGES.reduce((sum, stage) => sum + Math.max(0, stageCoverage[stage].expected - stageCoverage[stage].ready), 0);
  const metrics = { elapsedMs: Date.now() - started, sentenceCount: canonical.length, stageCoverage, incompleteStages, pdfExtractedExercises: Number(provenance.pdfExtractedExercises) || 0, sourceReusedExercises: stages.reduce((sum, stage) => sum + stage.items.length, 0), deterministicGeneratedExercises: 0, derivedFallbackExercises: 0, geminiGeneratedExercises: 0, geminiCallCount: 0, geminiTokenUsage: 0, validatorPass: stages.reduce((sum, stage) => sum + stage.items.length, 0), validatorDrop: drops.length, unresolved, dropReasons: drops.reduce((all, drop) => ({ ...all, [drop.reason]: (all[drop.reason] || 0) + 1 }), {}) };
  const source = { ...provenance, semanticContract: SEMANTIC_WORKBOOK_CONTRACT, geminiCallCount: 0 };
  return { contractVersion: SEMANTIC_WORKBOOK_CONTRACT, workbookKey: prefix, title: clean(title, 120) || 'READY Workbook', source, importReport: { factory: true, metrics, drops }, stages, metrics };
}
