export const QUESTION_DIFFICULTIES = Object.freeze([
  Object.freeze({ id: 1, label: 'Easy' }),
  Object.freeze({ id: 2, label: 'Standard' }),
  Object.freeze({ id: 3, label: 'Hard' }),
]);

export function normalizeQuestionDifficulty(value) {
  const difficulty = Number(value);
  return QUESTION_DIFFICULTIES.some(item => item.id === difficulty) ? difficulty : null;
}

export function questionDifficultyLabel(value) {
  return QUESTION_DIFFICULTIES.find(item => item.id === normalizeQuestionDifficulty(value))?.label || 'Unclassified';
}

export function isQuestionQaScope(scope) {
  const school = String(scope?.school ?? '').trim().toLowerCase();
  const grade = String(scope?.grade ?? '').trim();
  return (school === 'test' && grade === '1학년') || (school === 'test2' && grade === '2학년');
}

export function isAiReferenceVariant(payload) {
  return payload?.authoring?.method === 'ai_reference_variant';
}

export function questionVisibleInScope(row, scope) {
  return !isAiReferenceVariant(row?.payload) || isQuestionQaScope(scope);
}

export function questionFilterCounts(cells, difficulty = null, taxonomies = []) {
  const selectedDifficulty = normalizeQuestionDifficulty(difficulty);
  const selectedTaxonomies = new Set((taxonomies || []).map(String));
  const usable = (cells || []).map(cell => ({
    difficulty: normalizeQuestionDifficulty(cell?.difficulty),
    taxonomy: String(cell?.taxonomy ?? ''),
  })).filter(cell => cell.difficulty && cell.taxonomy);
  const difficultyCounts = new Map(QUESTION_DIFFICULTIES.map(item => [item.id, 0]));
  const taxonomyCounts = new Map();
  for (const cell of usable) {
    if (!selectedTaxonomies.size || selectedTaxonomies.has(cell.taxonomy)) {
      difficultyCounts.set(cell.difficulty, (difficultyCounts.get(cell.difficulty) || 0) + 1);
    }
    if (!selectedDifficulty || cell.difficulty === selectedDifficulty) {
      taxonomyCounts.set(cell.taxonomy, (taxonomyCounts.get(cell.taxonomy) || 0) + 1);
    }
  }
  const total = usable.filter(cell => (!selectedDifficulty || cell.difficulty === selectedDifficulty) && (!selectedTaxonomies.size || selectedTaxonomies.has(cell.taxonomy))).length;
  return { total, difficultyCounts, taxonomyCounts };
}
