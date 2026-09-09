const text = (value, limit = 4000) => String(value ?? '').trim().slice(0, limit);
const list = value => Array.isArray(value) ? value : [];

export const CONTENT_STATUSES = new Set(['draft', 'confirmed', 'stale']);
export const CONTENT_LANGUAGES = new Set(['en', 'ko']);

export function evidenceSnapshot(sentenceIds, sentenceRows) {
  const byId = new Map(list(sentenceRows).map(row => [String(row.id), row]));
  const unique = [...new Set(list(sentenceIds).map(String).filter(Boolean))];
  if (!unique.length || unique.length > 20) throw new Error('근거 문장을 하나 이상 선택해 주세요.');
  return unique.map(sentenceId => {
    const row = byId.get(sentenceId);
    if (!row || row.active === false || (row.blockType || row.block_type || 'SENTENCE') !== 'SENTENCE') throw new Error('현재 Passage 밖의 문장은 근거로 저장할 수 없습니다.');
    return { sentenceId, text: text(row.text) };
  });
}

export function factStale(fact, sentenceRows) {
  const byId = new Map(list(sentenceRows).map(row => [String(row.id), text(row.text)]));
  const snapshot = list(fact.evidence_snapshot);
  const ids = list(fact.evidence_sentence_ids).map(String);
  if (!ids.length || snapshot.length !== ids.length) return true;
  const saved = new Map(snapshot.map(item => [String(item?.sentenceId || item?.sentence_id || ''), text(item?.text)]));
  return ids.some(id => !byId.has(id) || !saved.has(id) || byId.get(id) !== saved.get(id));
}

export function staleFactIds(facts, sentenceRows) {
  return list(facts).filter(fact => fact.status !== 'stale' && factStale(fact, sentenceRows)).map(fact => fact.id);
}

export function publicContentClaims(facts, claims, sentenceRows) {
  const byFact = new Map(list(facts).filter(fact => fact.status === 'confirmed' && !factStale(fact, sentenceRows)).map(fact => [fact.id, fact]));
  const sentenceById = new Map(list(sentenceRows).map(row => [String(row.id), row]));
  return list(claims).filter(claim => claim.status === 'confirmed' && byFact.has(claim.fact_id)).map(claim => {
    const fact = byFact.get(claim.fact_id);
    return {
      id: claim.id,
      factId: claim.fact_id,
      statement: claim.statement,
      truth: claim.truth === true,
      language: claim.language,
      difficulty: Number(claim.difficulty) || 1,
      evidence: list(fact.evidence_sentence_ids).map(id => sentenceById.get(String(id))).filter(Boolean).map(row => ({
        sentenceId: row.id,
        sentenceNumber: Number(row.sentence_index) + 1,
        text: row.text,
      })),
    };
  });
}

export function contentClaimStage(claims) {
  const items = list(claims).map((claim, index) => ({
    key: `content-claim:${claim.id}`,
    stage: 10,
    semanticType: 'content_claim',
    number: index + 1,
    kind: 'content_claim',
    statement: claim.statement,
    truth: claim.truth,
    language: claim.language,
    difficulty: claim.difficulty,
    evidence: claim.evidence,
    slotCount: 1,
    completed: false,
    lastResult: null,
    bookmarked: false,
  }));
  return {
    stage: 10,
    semanticType: 'content_claim',
    title: '내용일치',
    instruction: '문장의 내용이 지문과 일치하면 O, 아니면 X를 고르세요.',
    locked: false,
    lockReason: '',
    total: items.length,
    attempted: 0,
    completed: 0,
    completedCycles: 0,
    currentCycle: 1,
    currentCycleClears: [],
    correctClears: 0,
    progressPercent: 0,
    items,
  };
}

export function insertContentClaimStage(stages, claims) {
  const next = [...list(stages)];
  if (!list(claims).length) return next;
  const koreanBlankIndex = next.findIndex(stage => stage?.semanticType === 'korean_blank');
  next.splice(koreanBlankIndex < 0 ? 0 : koreanBlankIndex, 0, contentClaimStage(claims));
  return next;
}
