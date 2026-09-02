// READY Workbook Factory.  This module deliberately contains no database or
// Gemini access so its parsing, generation and fail-closed validation can be
// exercised as a normal Node golden-path test as well as in the Edge Function.

const clean = (value, max = 6000) => String(value ?? '').replace(/\u00a0/g, ' ').trim().slice(0, max);
const fold = value => clean(value).toLowerCase().replace(/[“”‘’]/g, "'").replace(/\s+/g, ' ');
const words = value => clean(value).match(/[A-Za-z]+(?:[’'][A-Za-z]+)*/g) || [];
const koWords = value => clean(value).match(/[가-힣]+(?:[·ㆍ][가-힣]+)*/g) || [];
const stageMeta = {
  2: ['2단계 · 우리말 빈칸', '영문을 보고 우리말 해석의 빈칸을 완성하세요.'],
  3: ['3단계 · 영문 빈칸', '우리말 해석을 보고 영문의 빈칸을 완성하세요.'],
  4: ['4단계 · 해석 연습', '영문을 자연스러운 우리말로 해석하세요.'],
  5: ['5단계 · 동사형', '주어진 동사를 문장에 맞는 형태로 고쳐 쓰세요.'],
  6: ['6단계 · 어법·어휘 선택', '각 구간에서 알맞은 표현을 고르세요.'],
  7: ['7단계 · 오류 찾기', '어색한 표현을 찾아 알맞게 고쳐 쓰세요.'],
  8: ['8단계 · 순서 배열', '주어진 어구를 문장 순서로 배열하세요.'],
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
  const lines = sentenceLines(text), rows = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (isEnglish(lines[index]) && isKorean(lines[index + 1])) { rows.push({ text: lines[index], translation: lines[index + 1] }); index += 1; }
  }
  if (rows.length) return { rows, needsTranslation: false, pairing: 'alternating_lines' };
  const en = englishSentences(text), ko = koreanSentences(text);
  if (en.length && en.length === ko.length) return { rows: en.map((sentence, index) => ({ text: sentence, translation: ko[index] })), needsTranslation: false, pairing: 'matched_sentence_count' };
  if (en.length) return { rows: en.map(sentence => ({ text: sentence, translation: '' })), needsTranslation: true, pairing: 'english_only' };
  return { rows: [], needsTranslation: false, pairing: 'none' };
}

function pageBlocks(text) {
  const lines = sentenceLines(text), blocks = [], headings = [];
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
    const match = line.match(/^\s*(\d+)[.)]\s*(.+?)(?:\s*(?:\|\||\[?answer:?|정답[:：])\s*([^\]\n]+)\]?)?$/i);
    if (match) out.push({ number: Number(match[1]), prompt: clean(match[2]), answer: clean(match[3] || '') });
  }
  return out;
}

// Text-extractable PDFs often expose headings and answer key text in this
// order.  The parser intentionally returns review_required unless the Stage 4
// numbered English / Korean pairs are exact and complete.
export function inspectFullWorkbookText(text) {
  const { blocks, headings } = pageBlocks(text), semantic = headings.map(item => item.type);
  const answerKey = /answer\s*key|정답\s*(및|표|해설)?/i.test(text);
  const fullWorkbook = answerKey && new Set(semantic.filter(type => !['unknown', 'check_mixed', 'paragraph_ordering'].includes(type))).size >= 3;
  const translationBlocks = blocks.filter(block => semanticWorkbookType(block.title) === 'translation');
  const candidate = translationBlocks.flatMap(block => numberedPairs(block.body));
  const extracted = extractSentenceRows(text);
  const rows = extracted.rows;
  const confident = fullWorkbook && rows.length >= 2 && !extracted.needsTranslation && candidate.length >= rows.length;
  return {
    fullWorkbook, reviewRequired: !confident, rows, headings,
    exercises: blocks.flatMap(block => numberedPairs(block.body).map(item => ({ ...item, type: semanticWorkbookType(block.title), page: block.page, label: block.title }))),
    reason: confident ? 'numbered bilingual source and answer-key evidence agree' : 'canonical sentence pairs are not deterministically recoverable',
  };
}

function replaceOne(value, answer) { const at = value.indexOf(answer); return at < 0 ? null : `${value.slice(0, at)}______________${value.slice(at + answer.length)}`; }
function restoreBlank(value, answer) { return clean(value).replace(/_{5,}/, answer); }
function chooseEnglish(sentence) { return words(sentence).filter(word => word.length >= 4).sort((a, b) => b.length - a.length)[0] || words(sentence)[0] || ''; }
function chooseKorean(sentence) { return koWords(sentence).filter(word => word.length >= 2).sort((a, b) => b.length - a.length)[0] || koWords(sentence)[0] || ''; }
function chunks(sentence) {
  const tokens = words(sentence); if (tokens.length < 4) return [];
  const size = Math.max(2, Math.ceil(tokens.length / 3)), parts = [];
  for (let at = 0; at < tokens.length; at += size) parts.push(tokens.slice(at, at + size).join(' '));
  return parts.length >= 2 ? parts : [];
}
function item(stage, number, key, fields) { return { key, stage, number, ...fields }; }
function factoryKey(prefix, stage, number) { return `${prefix}-s${stage}-${String(number).padStart(2, '0')}`; }

function deterministicItems(rows, prefix) {
  const byStage = new Map(FACTORY_STAGES.map(stage => [stage, []]));
  rows.forEach((row, index) => {
    const number = index + 1, en = clean(row.text), ko = clean(row.translation), english = chooseEnglish(en), korean = chooseKorean(ko);
    const enBlank = replaceOne(en, english), koBlank = replaceOne(ko, korean), ordered = chunks(en);
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

function normalizeAiItem(stage, raw, rows, prefix, number) {
  const sentenceIndex = Number(raw?.sentenceIndex) - 1, row = rows[sentenceIndex]; if (!row) return null;
  const canonicalNumber = sentenceIndex + 1, en = clean(row.text), ko = clean(row.translation), key = factoryKey(prefix, stage, canonicalNumber);
  if (stage === 5) {
    const answer = clean(raw?.answer, 160), prompt = clean(raw?.prompt, 2000), hint = clean(raw?.hint, 120);
    return answer && hint && prompt && restoreBlank(prompt, answer) === en ? item(5, canonicalNumber, key, { kind: 'verb_form', source: ko, prompt, hints: [hint], answers: [answer] }) : null;
  }
  if (stage === 6) {
    const answer = clean(raw?.answer, 160), wrong = clean(raw?.wrong, 160), prompt = clean(raw?.prompt, 2000);
    return answer && wrong && answer !== wrong && prompt && restoreBlank(prompt, answer) === en ? item(6, canonicalNumber, key, { kind: 'choice_groups', source: ko, prompt: prompt.replace(/_{5,}/, '⟦CHOICE:0⟧'), groups: [[wrong, answer]], answers: [answer] }) : null;
  }
  if (stage === 7) {
    const wrong = clean(raw?.wrong, 160), correct = clean(raw?.correct, 160), sentence = clean(raw?.sentence, 2000);
    return wrong && correct && wrong !== correct && sentence === en.replace(correct, wrong) && en.includes(correct) ? item(7, canonicalNumber, key, { kind: 'correction_pairs', source: '', prompt: sentence, pairCount: 1, subtype: 'sentence', answers: [wrong, correct] }) : null;
  }
  return null;
}

function validateItem(stage, candidate, rowByNumber) {
  const row = rowByNumber.get(candidate.number); if (!row) return 'missing_canonical_sentence';
  const en = clean(row.text), ko = clean(row.translation);
  if (stage === 2) return candidate.answers?.length === 1 && candidate.source === en && restoreBlank(candidate.prompt, candidate.answers[0]) === ko ? '' : 'stage2_round_trip';
  if (stage === 3) return candidate.answers?.length === 1 && candidate.source === ko && restoreBlank(candidate.prompt, candidate.answers[0]) === en ? '' : 'stage3_round_trip';
  if (stage === 4) return candidate.kind === 'translation_ai' && candidate.source === en && candidate.answers?.[0] === ko ? '' : 'stage4_reference';
  if (stage === 5) return candidate.kind === 'verb_form' && candidate.answers?.length === 1 && restoreBlank(candidate.prompt, candidate.answers[0]) === en ? '' : 'stage5_round_trip';
  if (stage === 6) { const answer = candidate.answers?.[0]; return candidate.kind === 'choice_groups' && candidate.groups?.[0]?.includes(answer) && candidate.prompt?.replace('⟦CHOICE:0⟧', answer) === en ? '' : 'stage6_round_trip'; }
  if (stage === 7) return candidate.kind === 'correction_pairs' && candidate.answers?.length === 2 && candidate.prompt?.replace(candidate.answers[0], candidate.answers[1]) === en ? '' : 'stage7_round_trip';
  if (stage === 8) return candidate.kind === 'reorder_groups' && candidate.answers?.[0] && fold(candidate.answers[0]) === fold(en.replace(/[.!?]+$/, '')) ? '' : 'stage8_round_trip';
  if (stage === 9) return candidate.kind === 'blank_input' && fold(candidate.answers?.join(' ')) === fold(en.replace(/[.!?]+$/, '')) ? '' : 'stage9_reference';
  return 'unsupported_stage';
}

export function generateWorkbookCatalog({ title, workbookKey, rows, ai = {}, provenance = {} }) {
  const started = Date.now(), canonical = rows.map((row, index) => ({ text: clean(row?.text), translation: clean(row?.translation), index: index + 1 })).filter(row => row.text && row.translation);
  if (!canonical.length || canonical.length !== rows.length) throw new Error('Canonical English/Korean sentence pairs are required.');
  const prefix = clean(workbookKey, 100).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'factory';
  const generated = deterministicItems(canonical, prefix), rowByNumber = new Map(canonical.map(row => [row.index, row])), drops = [];
  for (const stage of [5, 6, 7]) (Array.isArray(ai[stage]) ? ai[stage] : []).forEach((raw, index) => {
    const candidate = normalizeAiItem(stage, raw, canonical, prefix, index + 1); if (candidate) generated.get(stage).push(candidate); else drops.push({ stage, number: Number(raw?.sentenceIndex) || index + 1, reason: `stage${stage}_round_trip` });
  });
  const stages = FACTORY_STAGES.map(stage => {
    const valid = [];
    for (const candidate of generated.get(stage) || []) { const reason = validateItem(stage, candidate, rowByNumber); if (reason) drops.push({ stage, number: candidate.number, reason }); else valid.push(candidate); }
    const [stageTitle, instruction] = stageMeta[stage]; return { stage, title: stageTitle, instruction, items: valid };
  });
  const count = stage => stages.find(item => item.stage === stage)?.items.length || 0;
  const metrics = { elapsedMs: Date.now() - started, sentenceCount: canonical.length, pdfExtractedExercises: Number(provenance.pdfExtractedExercises) || 0, deterministicGeneratedExercises: [2, 3, 4, 8, 9].reduce((sum, stage) => sum + count(stage), 0), geminiGeneratedExercises: [5, 6, 7].reduce((sum, stage) => sum + count(stage), 0), geminiCallCount: Number(provenance.geminiCallCount) || 0, geminiTokenUsage: Number(provenance.geminiTokenUsage) || 0, validatorPass: stages.reduce((sum, stage) => sum + stage.items.length, 0), validatorDrop: drops.length, dropReasons: drops.reduce((all, drop) => ({ ...all, [drop.reason]: (all[drop.reason] || 0) + 1 }), {}) };
  return { workbookKey: prefix, title: clean(title, 120) || 'READY Workbook', source: provenance, importReport: { factory: true, metrics, drops }, stages, metrics };
}
