export const UNGROUPED = '';

export function createScopeLayout(links = []) {
  const groups = [];
  const byKey = new Map();
  const ungrouped = [];
  for (const link of [...links].sort((a, b) => Number(a.position) - Number(b.position))) {
    const passageId = link.passage_id || link.passageId;
    if (!link.group_key) { ungrouped.push(passageId); continue; }
    let group = byKey.get(link.group_key);
    if (!group) {
      group = { key: link.group_key, label: link.group_label, passageIds: [] };
      byKey.set(group.key, group); groups.push(group);
    }
    group.passageIds.push(passageId);
  }
  return { groups, ungrouped };
}

export function flattenScopeLayout(layout) {
  return [
    ...layout.groups.flatMap(group => group.passageIds.map(passageId => ({ passageId, groupKey: group.key, groupLabel: group.label.trim() }))),
    ...layout.ungrouped.map(passageId => ({ passageId, groupKey: null, groupLabel: null })),
  ];
}

export function uniqueGroupKey(layout) {
  const used = new Set(layout.groups.map(group => group.key));
  let key;
  do { key = `group-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; } while (used.has(key));
  return key;
}

export function addGroup(layout, label = '새 묶음') {
  layout.groups.push({ key: uniqueGroupKey(layout), label, passageIds: [] });
}

export function removeGroup(layout, key) {
  const index = layout.groups.findIndex(group => group.key === key);
  if (index < 0) return;
  layout.ungrouped.push(...layout.groups[index].passageIds);
  layout.groups.splice(index, 1);
}

export function moveGroup(layout, key, targetIndex) {
  const from = layout.groups.findIndex(group => group.key === key);
  if (from < 0) return;
  const [group] = layout.groups.splice(from, 1);
  const adjusted = from < targetIndex ? targetIndex - 1 : targetIndex;
  layout.groups.splice(Math.max(0, Math.min(adjusted, layout.groups.length)), 0, group);
}

function passageList(layout, groupKey) {
  return groupKey ? layout.groups.find(group => group.key === groupKey)?.passageIds : layout.ungrouped;
}

export function movePassage(layout, passageId, targetGroupKey = UNGROUPED, targetIndex = Number.MAX_SAFE_INTEGER) {
  for (const list of [...layout.groups.map(group => group.passageIds), layout.ungrouped]) {
    const index = list.indexOf(passageId);
    if (index >= 0) list.splice(index, 1);
  }
  const target = passageList(layout, targetGroupKey);
  if (!target) return;
  target.splice(Math.max(0, Math.min(targetIndex, target.length)), 0, passageId);
}

export function removePassage(layout, passageId) {
  for (const list of [...layout.groups.map(group => group.passageIds), layout.ungrouped]) {
    const index = list.indexOf(passageId);
    if (index >= 0) list.splice(index, 1);
  }
}

export function passageIds(layout) {
  return flattenScopeLayout(layout).map(item => item.passageId);
}
