const text = (value, limit = 4000) => String(value ?? '').trim().slice(0, limit);
const list = value => Array.isArray(value) ? value : [];

export const CONTENT_STATUSES = new Set(['draft', 'confirmed', 'stale']);
export const CONTENT_LANGUAGES = new Set(['en', 'ko']);

// Ordered preference groups keep the progression adjustable without creating a
// separate adaptive system. Entries in the first available group are sampled.
export const CONTENT_VARIANT_TIERS = Object.freeze([
  { minPercent: 300, preferences: [[['en', 3], ['en', 3], ['en', 2]], [['ko', 3]], [['en', 1]], [['ko', 2]], [['ko', 1]]] },
  { minPercent: 200, preferences: [[['en', 2]], [['en', 1], ['en', 3]], [['ko', 2], ['ko', 3]], [['ko', 1]]] },
  { minPercent: 100, preferences: [[['ko', 2], ['en', 1]], [['ko', 1], ['en', 2]], [['ko', 3], ['en', 3]]] },
  { minPercent: 0, preferences: [[['ko', 1]], [['ko', 2], ['en', 1]], [['en', 2], ['ko', 3]], [['en', 3]]] },
]);

function shuffled(values, random = Math.random) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

export function selectContentClaimVariant(claim, progressPercent = 0, random = Math.random) {
  const variants = list(claim?.variants).filter(variant => variant?.status === 'confirmed');
  if (!variants.length) return null;
  const tier = CONTENT_VARIANT_TIERS.find(candidate => Number(progressPercent) >= candidate.minPercent) || CONTENT_VARIANT_TIERS.at(-1);
  for (const group of tier.preferences) {
    const weighted = group.flatMap(([language, difficulty]) => variants.filter(variant => variant.language === language && Number(variant.difficulty) === difficulty));
    if (weighted.length) return weighted[Math.floor(random() * weighted.length)];
  }
  return variants[Math.floor(random() * variants.length)];
}

export function contentClaimBag(claims, random = Math.random) {
  const output = shuffled(list(claims), random);
  const score = values => values.reduce((total, claim, index) => total
    + (index > 0 && claim.factId === values[index - 1]?.factId ? output.length + 1 : 0)
    + (index > 1 && claim.truth === values[index - 1]?.truth && claim.truth === values[index - 2]?.truth ? 1 : 0), 0);
  for (let current = score(output), pass = 0; current > 0 && pass < output.length; pass += 1) {
    let best = current, pair = null;
    for (let left = 0; left < output.length - 1; left += 1) for (let right = left + 1; right < output.length; right += 1) {
      [output[left], output[right]] = [output[right], output[left]];
      const candidate = score(output);
      [output[left], output[right]] = [output[right], output[left]];
      if (candidate < best) { best = candidate; pair = [left, right]; }
    }
    if (!pair) break;
    [output[pair[0]], output[pair[1]]] = [output[pair[1]], output[pair[0]]];
    current = best;
  }
  return output;
}

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

export function publicContentClaims(facts, claims, variants, sentenceRows) {
  const byFact = new Map(list(facts).filter(fact => fact.status === 'confirmed' && !factStale(fact, sentenceRows)).map(fact => [fact.id, fact]));
  const sentenceById = new Map(list(sentenceRows).map(row => [String(row.id), row]));
  const variantsByClaim = new Map();
  for (const variant of list(variants).filter(variant => variant.status === 'confirmed')) {
    const owned = variantsByClaim.get(variant.claim_id) || [];
    owned.push(variant);
    variantsByClaim.set(variant.claim_id, owned);
  }
  return list(claims).filter(claim => claim.status === 'confirmed' && byFact.has(claim.fact_id)).map(claim => {
    const fact = byFact.get(claim.fact_id);
    return {
      id: claim.id,
      factId: claim.fact_id,
      statement: claim.statement,
      truth: claim.truth === true,
      language: claim.language,
      difficulty: Number(claim.difficulty) || 1,
      variants: variantsByClaim.get(claim.id) || [],
      evidence: list(fact.evidence_sentence_ids).map(id => sentenceById.get(String(id))).filter(Boolean).map(row => ({
        sentenceId: row.id,
        sentenceNumber: Number(row.sentence_index) + 1,
        text: row.text,
      })),
    };
  });
}

export function contentClaimStage(claims, progress = {}, random = Math.random) {
  const correctClears = Number(progress.correctClears) || 0, total = list(claims).length;
  const progressPercent = total ? Math.floor(correctClears * 100 / total) : 0;
  const items = contentClaimBag(claims, random).map((claim, index) => {
    const variant = selectContentClaimVariant(claim, progressPercent, random);
    return {
    key: `content-claim:${claim.id}`,
    stage: 10,
    semanticType: 'content_claim',
    number: index + 1,
    kind: 'content_claim',
    claimId: claim.id,
    factId: claim.factId,
    variantId: variant?.id || null,
    statement: variant?.statement || claim.statement,
    truth: claim.truth,
    language: variant?.language || claim.language,
    difficulty: Number(variant?.difficulty || claim.difficulty) || 1,
    evidence: claim.evidence,
    slotCount: 1,
    completed: list(progress.currentCycleClears).includes(`content-claim:${claim.id}`),
    lastResult: null,
    bookmarked: false,
    };
  });
  return {
    stage: 10,
    semanticType: 'content_claim',
    title: '내용일치',
    instruction: '문장의 내용이 지문과 일치하면 O, 아니면 X를 고르세요.',
    locked: false,
    lockReason: '',
    total,
    attempted: 0,
    completed: list(progress.currentCycleClears).length,
    completedCycles: Number(progress.completedCycles) || 0,
    currentCycle: Number(progress.currentCycle) || 1,
    currentCycleClears: [...list(progress.currentCycleClears)],
    correctClears,
    progressPercent,
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
