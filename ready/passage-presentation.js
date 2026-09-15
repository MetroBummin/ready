// Presentation-only helpers for the student Passage list.  They intentionally
// do not infer an exam question number from list position, IDs, or any other
// incidental ordering value.

const text = value => typeof value === 'string' ? value.replace(/\u00a0/g, ' ').trim() : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const metadataSources = value => [object(value), object(value?.metadata)].filter(Boolean);

const CANONICAL_MOCK_EXAM_TITLE = /^(?<year>(?:20)?\d{2})\s*년\s*(?<month>1[0-2]|[1-9])\s*월\s*(?:[·ㆍ,，:：/－\-–—]\s*)?(?<grade>고\s*[1-3]|[1-3]\s*학년)\s*(?:[·ㆍ,，:：/－\-–—]\s*)?모의\s*고사\s*(?:[·ㆍ,，:：/－\-–—]\s*)?(?<question>[1-9]\d?(?:\s*[~～∼\-–—]\s*[1-9]\d?)?)\s*번(?:\s*[.!?。])?$/u;
const EXPLICIT_QUESTION = /^([1-9]\d?)(?:\s*[~～∼\-–—]\s*([1-9]\d?))?\s*(?:번)?$/u;
const QUESTION_FIELDS = ['questionNumber', 'question_number', 'questionNo', 'question_no', 'sourceQuestionNo', 'source_question_no'];

function valueFrom(sources, fields) {
  for (const source of sources) for (const field of fields) {
    const value = source?.[field];
    if (value !== undefined && value !== null && text(String(value))) return value;
  }
  return null;
}

function integer(value, min, max) {
  const number = typeof value === 'number' ? value : Number(text(String(value)));
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function normalizeQuestion(value) {
  if (typeof value === 'number') return integer(value, 1, 99) ? String(value) : null;
  const match = text(value).match(EXPLICIT_QUESTION);
  if (!match) return null;
  const first = Number(match[1]), last = match[2] ? Number(match[2]) : null;
  if (first < 1 || first > 99 || (last !== null && (last <= first || last > 99))) return null;
  return last === null ? String(first) : `${first}~${last}`;
}

function explicitQuestion(metadata) {
  const supplied = [];
  for (const source of metadataSources(metadata)) for (const field of QUESTION_FIELDS) {
    const value = source[field];
    if (value !== undefined && value !== null && text(String(value))) supplied.push(value);
  }
  if (!supplied.length) return { state: 'absent', value: null };
  const values = supplied.map(normalizeQuestion);
  if (values.some(value => !value)) return { state: 'invalid', value: null };
  const unique = [...new Set(values)];
  return unique.length === 1 ? { state: 'explicit', value: unique[0] } : { state: 'ambiguous', value: null };
}

function normalizedGrade(value) {
  const grade = text(value).replace(/\s+/g, ' ');
  const match = grade.match(/^(?:고\s*)?([1-3])(?:\s*학년)?$/);
  if (match) return `고${match[1]}`;
  return grade && grade.length <= 40 ? grade : '';
}

function parsedTitle(title) {
  const match = text(title).match(CANONICAL_MOCK_EXAM_TITLE);
  if (!match?.groups) return null;
  const parsedYear = Number(match.groups.year);
  const year = match.groups.year.length === 2 ? 2000 + parsedYear : parsedYear;
  const month = Number(match.groups.month), question = normalizeQuestion(match.groups.question);
  if (!question) return null;
  return {
    year,
    month,
    grade: normalizedGrade(match.groups.grade),
    question,
    questionLabel: `${question}번`,
  };
}

/**
 * Parse only the known complete title form, not arbitrary digits in a title.
 * An optional explicit question field may override the title number, but an
 * invalid or conflicting set of explicit fields fails closed.
 */
export function parseMockExamTitle(title, metadata) {
  const parsed = parsedTitle(title);
  if (!parsed) return null;
  const explicit = explicitQuestion(metadata);
  if (explicit.state === 'invalid' || explicit.state === 'ambiguous') return null;
  const question = explicit.value || parsed.question;
  return { ...parsed, question, questionLabel: `${question}번`, questionSource: explicit.value ? 'metadata' : 'title' };
}

function mockExamMetadata(passage, parsed) {
  const sources = metadataSources(passage);
  const grade = normalizedGrade(valueFrom(sources, ['grade'])) || parsed?.grade || '';
  const sourceYear = integer(valueFrom(sources, ['source_year', 'sourceYear']), 2000, 2099) ?? parsed?.year ?? null;
  const sourceMonth = integer(valueFrom(sources, ['source_month', 'sourceMonth']), 1, 12) ?? parsed?.month ?? null;
  const date = sourceYear && sourceMonth ? `${sourceYear}년 ${sourceMonth}월` : sourceYear ? `${sourceYear}년` : sourceMonth ? `${sourceMonth}월` : '';
  return { grade, sourceYear, sourceMonth, metaLabel: [grade, date].filter(Boolean).join(' · ') };
}

/**
 * Return a compact display model only when the Passage is safely identifiable
 * as a mock exam.  Callers should render the original title when this returns
 * null; this deliberately leaves textbooks, ambiguous metadata, and loose
 * title matches untouched.
 */
export function presentPassageTitle(passage) {
  const sources = metadataSources(passage);
  const sourceType = text(valueFrom(sources, ['source_type', 'sourceType'])).toUpperCase();
  if (sourceType !== 'MOCK_EXAM') return null;
  const title = text(valueFrom(sources, ['title']));
  const parsed = parseMockExamTitle(title);
  const explicit = explicitQuestion(passage);
  if (explicit.state === 'invalid' || explicit.state === 'ambiguous') return null;
  const question = explicit.value || parsed?.question;
  if (!question) return null;
  const metadata = mockExamMetadata(passage, parsed);
  return {
    title,
    fallbackTitle: title,
    question,
    questionLabel: `${question}번`,
    questionSource: explicit.value ? 'metadata' : 'title',
    ...metadata,
  };
}
