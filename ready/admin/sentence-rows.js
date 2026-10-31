// Admin sentence-set editor helpers. Pure functions so they can be unit tested.

// One line per sentence: "English<TAB>Korean". Blank lines are ignored.
export function parseSentenceRows(source = '') {
  const rows = [], errors = [];
  String(source ?? '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const [text = '', translation = '', ...extra] = line.split('\t').map(value => value.trim());
    if (!text || !translation || extra.some(Boolean)) errors.push(`${index + 1}번째 줄은 "English[TAB]Korean" 두 칸이어야 합니다.`);
    else rows.push({ text, translation });
  });
  if (!rows.length && !errors.length) errors.push('문장을 한 개 이상 입력해 주세요.');
  return { rows, errors };
}

// Keep sentence ids (and therefore attempt history) stable across edits:
// a line keeps the id of an unused previous row with the same English text,
// otherwise the id of the previous row at the same position, otherwise none.
export function matchEditorRows(previous = [], next = []) {
  const used = new Set(), byText = new Map();
  previous.forEach((row, index) => { if (row?.id && !byText.has(row.text)) byText.set(row.text, index); });
  const assigned = next.map(row => { const index = byText.get(row.text); if (index === undefined || used.has(index)) return -1; used.add(index); return index; });
  return next.map((row, position) => {
    let index = assigned[position];
    if (index < 0 && previous[position]?.id && !used.has(position)) { index = position; used.add(position); }
    return { id: index >= 0 ? previous[index].id : null, text: row.text, translation: row.translation };
  });
}
