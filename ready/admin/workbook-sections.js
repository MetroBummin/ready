// One shared source of truth for Studio navigation and list-level publication status.
// Add future Workbook types here so both surfaces gain the same denominator automatically.
export const WORKBOOK_SECTIONS = [
  {
    key: 'auto',
    label: 'AUTO',
    types: [
      { key: 'translation', label: '해석', studioStep: 'translation', semanticTypes: ['translation'] },
      { key: 'writing', label: '영작', studioStep: 'writing', semanticTypes: ['writing'] },
      { key: 'word_order', label: '배열', studioStep: 'word_order', semanticTypes: ['word_order'] },
    ],
  },
  {
    key: 'authoring',
    label: 'AUTHORING',
    types: [
      { key: 'blank', label: '빈칸', studioStep: 'blank_pair', semanticTypes: ['english_blank', 'korean_blank'] },
      { key: 'verb_form', label: '동사형', studioStep: 'verb_form', semanticTypes: ['verb_form'] },
      { key: 'grammar_choice', label: '어법 선택', studioStep: 'grammar_choice', semanticTypes: ['grammar_choice'] },
    ],
  },
  {
    key: 'comprehension',
    label: 'COMPREHENSION',
    types: [
      { key: 'content_claim', label: '내용일치', studioStep: 'content_claim', semanticTypes: ['content_claim'] },
    ],
  },
];

export function studioStepForSection(sectionKey) {
  return WORKBOOK_SECTIONS.find(section => section.key === sectionKey)?.types[0]?.studioStep || '';
}

export function workbookPublicationSummary({ catalog = null, publishedSteps = [], publishedContentTypes = [] } = {}) {
  const published = new Set([...publishedSteps, ...publishedContentTypes]);
  for (const stage of catalog?.stages || []) {
    if (Array.isArray(stage?.items) && stage.items.length && stage.semanticType) published.add(stage.semanticType);
  }
  return WORKBOOK_SECTIONS.map(section => {
    const types = section.types.map(type => ({
      key: type.key,
      published: type.semanticTypes.every(semanticType => published.has(semanticType)),
    }));
    return { key: section.key, published: types.filter(type => type.published).length, total: types.length, types };
  });
}
