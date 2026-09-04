import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addGroup, createScopeLayout, emptyGroupDefinitions, flattenScopeLayout, moveGroup, movePassage, removeGroup } from '../ready/admin/scope-layout.js';

const links = [
  { passage_id:'A', position:0, group_key:'mock', group_label:'모의고사' },
  { passage_id:'B', position:1, group_key:'mock', group_label:'모의고사' },
  { passage_id:'C', position:2, group_key:'mock', group_label:'모의고사' },
  { passage_id:'D', position:3, group_key:'supplement', group_label:'부교재' },
  { passage_id:'E', position:4, group_key:'supplement', group_label:'부교재' },
];
const layout=createScopeLayout(links);
movePassage(layout,'C','mock',0);
assert.deepEqual(layout.groups[0].passageIds,['C','A','B']);
movePassage(layout,'C','mock',1);
assert.deepEqual(layout.groups[0].passageIds,['A','C','B']);
movePassage(layout,'C','mock',0);
movePassage(layout,'B','supplement');
assert.deepEqual(layout.groups[0].passageIds,['C','A']);
assert.deepEqual(layout.groups[1].passageIds,['D','E','B']);
moveGroup(layout,'supplement',0);
assert.deepEqual(flattenScopeLayout(layout).map(item=>item.passageId),['D','E','B','C','A']);

layout.groups[0].label='새 부교재';
assert.equal(flattenScopeLayout(layout)[0].groupLabel,'새 부교재');
removeGroup(layout,'supplement');
assert.deepEqual(layout.ungrouped,['D','E','B']);
assert.ok(flattenScopeLayout(layout).slice(-3).every(item=>item.groupKey===null));

const nullLayout=createScopeLayout([
  {passage_id:'one',position:0,group_key:null,group_label:null},
  {passage_id:'two',position:1,group_key:null,group_label:null},
]);
assert.deepEqual(flattenScopeLayout(nullLayout),[
  {passageId:'one',groupKey:null,groupLabel:null},
  {passageId:'two',groupKey:null,groupLabel:null},
]);

const emptyLayout=createScopeLayout([]);
addGroup(emptyLayout,'빈 묶음');
const savedEmpty=emptyGroupDefinitions(emptyLayout);
assert.equal(savedEmpty.length,1);
assert.equal(savedEmpty[0].label,'빈 묶음');
const reloadedEmpty=createScopeLayout([],savedEmpty);
assert.equal(reloadedEmpty.groups[0].label,'빈 묶음');
assert.deepEqual(reloadedEmpty.groups[0].passageIds,[]);

const migration=fs.readFileSync(new URL('../supabase/migrations/20260904040318_scope_passage_groups.sql',import.meta.url),'utf8');
for(const contract of [
  'ready_set_scope_layout',
  'ready_set_scope_definition',
  '중복된 Passage가 포함되어 있습니다.',
  '현재 시험범위의 모든 Passage를 정확히 한 번 포함해야 합니다.',
  '같은 groupKey에 서로 다른 이름을 사용할 수 없습니다.',
  '같은 묶음의 Passage는 연속되어야 합니다.',
  "('test', '1학년', 'test 1학년')",
  "('test2', '2학년', 'test2 2학년')",
]) assert.ok(migration.includes(contract),`migration contract missing: ${contract}`);
assert.ok(!migration.includes('group_position'));
for(const protectedTable of ['ready_passage_sentences','ready_questions','ready_attempts','ready_workbook_catalogs','ready_workbook_attempts']){
  assert.ok(!migration.includes(protectedTable),`migration must not mutate ${protectedTable}`);
}
assert.doesNotMatch(migration,/(?:insert\s+into|update|delete\s+from)\s+public\.ready_passages\b/i,'Passage source rows must stay immutable');
const followupMigration=fs.readFileSync(new URL('../supabase/migrations/20260904051836_scope_group_followups.sql',import.meta.url),'utf8');
for(const contract of ['empty_passage_groups','ready_exam_passages_grade_match_trigger','신흥고 2학년 시험범위','passage.grade <> exam.grade']){
  assert.ok(followupMigration.includes(contract),`follow-up migration contract missing: ${contract}`);
}
for(const protectedTable of ['ready_passage_sentences','ready_questions','ready_attempts','ready_workbook_catalogs','ready_workbook_attempts']){
  assert.ok(!followupMigration.includes(protectedTable),`follow-up migration must not mutate ${protectedTable}`);
}

const server=fs.readFileSync(new URL('../server/ready/index.ts',import.meta.url),'utf8');
assert.match(server,/groupKey:\s*link\.group_key, groupLabel:\s*link\.group_label/);
assert.match(server,/case "set_scope_layout": return setScopeLayout/);
assert.match(server,/empty_passage_groups/);
assert.match(server,/p_layout:\{items:layout,emptyGroups\}/);
const student=fs.readFileSync(new URL('../ready/app.js',import.meta.url),'utf8');
assert.match(student,/student-scope-group/);
assert.match(student,/passage\.groupKey/);
assert.match(student,/<details class="student-scope-group" open>/);
const admin=fs.readFileSync(new URL('../ready/admin/app.js',import.meta.url),'utf8');
assert.match(admin,/data-toggle-scope-group/);

console.log('READY scope layout checks passed');
