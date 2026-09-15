// Presentation-only grouping for the Workbook stage picker.  Entries retain a
// reference to their source stage and its original array index so rendering a
// group cannot alter navigation, locking, or progress semantics.

export const WORKBOOK_STAGE_GROUPS = Object.freeze([
  Object.freeze({
    key: 'basic-understanding',
    title: '기본 이해',
    description: '지문의 내용을 정확히 이해하고 기본기를 다져요.',
    icon: '▤',
    semanticTypes: Object.freeze(['content_claim', 'korean_blank', 'english_blank', 'translation']),
  }),
  Object.freeze({
    key: 'grammar',
    title: '문법',
    description: '핵심 문법을 익히고 문장 구조를 정확히 이해해요.',
    icon: '⚙',
    semanticTypes: Object.freeze(['verb_form', 'grammar_choice']),
  }),
  Object.freeze({
    key: 'memorization',
    title: '암기',
    description: '문장을 직접 만들며 표현을 내 것으로 만들어요.',
    icon: '✎',
    semanticTypes: Object.freeze(['word_order', 'writing']),
  }),
]);

export const WORKBOOK_STAGE_PRESENTATION = Object.freeze({
  content_claim: Object.freeze({ label: '내용일치', icon: '☑' }),
  korean_blank: Object.freeze({ label: '우리말 빈칸', icon: '가' }),
  english_blank: Object.freeze({ label: '영어 빈칸', icon: 'A' }),
  translation: Object.freeze({ label: '해석', icon: '▤' }),
  verb_form: Object.freeze({ label: '동사형', icon: '⌁' }),
  grammar_choice: Object.freeze({ label: '어법 선택', icon: '✓' }),
  word_order: Object.freeze({ label: '어순배열', icon: '☷' }),
  writing: Object.freeze({ label: '영작', icon: '✎' }),
});

const GROUP_BY_TYPE = new Map(WORKBOOK_STAGE_GROUPS.flatMap(group => group.semanticTypes.map(semanticType => [semanticType, group.key])));
const titleWithoutLegacyStage = value => String(value ?? '').replace(/^\s*\d+\s*단계\s*[·:—-]?\s*/, '').trim();
const semanticTypeOf = stage => String(stage?.semanticType ?? stage?.semantic_type ?? '').trim().toLowerCase();

export function workbookStagePresentation(stage, index = 0) {
  const semanticType = semanticTypeOf(stage), known = WORKBOOK_STAGE_PRESENTATION[semanticType];
  return {
    stage,
    index,
    stageIndex: index,
    locked: stage?.locked === true,
    semanticType,
    label: known?.label || titleWithoutLegacyStage(stage?.title || stage?.instruction) || '기타 학습',
    icon: known?.icon || '…',
  };
}

/**
 * Group every supplied stage exactly once.  Known semantic types use the
 * fixed student-facing order; unknown types stay visible together in one
 * fallback group rather than being silently dropped.
 */
export function groupWorkbookStages(stages) {
  const byGroup = new Map(WORKBOOK_STAGE_GROUPS.map(group => [group.key, []]));
  const other = [];
  for (const [index, stage] of (Array.isArray(stages) ? stages : []).entries()) {
    const presentation = workbookStagePresentation(stage, index), groupKey = GROUP_BY_TYPE.get(presentation.semanticType);
    if (groupKey) byGroup.get(groupKey).push(presentation);
    else other.push(presentation);
  }
  const groups = WORKBOOK_STAGE_GROUPS.map(group => ({
    ...group,
    stages: byGroup.get(group.key).sort((left, right) => {
      const leftOrder = group.semanticTypes.indexOf(left.semanticType), rightOrder = group.semanticTypes.indexOf(right.semanticType);
      return leftOrder - rightOrder || left.index - right.index;
    }),
  })).filter(group => group.stages.length);
  if (other.length) groups.push({ key: 'other', title: '기타 학습', description: '준비된 다른 학습 항목', icon: '…', semanticTypes: [], stages: other });
  return groups;
}
