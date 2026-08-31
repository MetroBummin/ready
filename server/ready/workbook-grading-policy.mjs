export const WORKBOOK_TRANSLATION_GRADING_POLICY = Object.freeze({
  version: "workbook_translation_v1",
  passScore: 75,
  rubric: Object.freeze({ semanticMeaning: 60, coreRelations: 30, naturalKorean: 10 }),
});

export function workbookTranslationPass(score, criticalErrors = []) {
  return Number(score) >= WORKBOOK_TRANSLATION_GRADING_POLICY.passScore
    && Array.isArray(criticalErrors)
    && criticalErrors.length === 0;
}
