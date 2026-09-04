export const QUESTION_DIFFICULTIES = Object.freeze([
  Object.freeze({ id: 1, label: "Easy" }),
  Object.freeze({ id: 2, label: "Standard" }),
  Object.freeze({ id: 3, label: "Hard" }),
]);

export function normalizeQuestionDifficulty(value) {
  const difficulty = Number(value);
  return QUESTION_DIFFICULTIES.some(item => item.id === difficulty) ? difficulty : null;
}

export function isQuestionQaScope(scope) {
  const school = String(scope?.school ?? "").trim().toLowerCase();
  const grade = String(scope?.grade ?? "").trim();
  return (school === "test" && grade === "1학년") || (school === "test2" && grade === "2학년");
}

export function isAiReferenceVariant(payload) {
  return ["ai_reference_variant", "ai_reference_variant_v2"].includes(payload?.authoring?.method);
}

export function isAiReferenceVariantV2(payload) {
  return payload?.authoring?.method === "ai_reference_variant_v2";
}

export function questionVisibleInScope(row, scope) {
  if (isAiReferenceVariantV2(row?.payload)) return String(scope?.school ?? "").trim().toLowerCase() === "test2" && String(scope?.grade ?? "").trim() === "2학년";
  return !isAiReferenceVariant(row?.payload) || isQuestionQaScope(scope);
}
