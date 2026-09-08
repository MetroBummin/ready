import assert from 'node:assert/strict';
import {AUTHORED, PURE, tokenSpan, syncAnnotations, dirtyRows} from '../ready/admin/studio-contract.js';
import {compileStudio} from '../server/ready/studio-authoring.mjs';

// Deliberately > one authoring batch; a late edit must not invalidate the prefix.
const rows = [
  {id:'heading', blockType:'TITLE', text:'Canonical edit regression', translation:''},
  ...Array.from({length:20}, (_,i)=>({id:`sentence-${i+1}`, blockType:'SENTENCE', paragraphIndex:Math.floor(i/5), text:`Students learn lesson ${i+1} together every day.`, translation:`학생들은 매일 ${i+1}번 수업을 함께 배운다.`})),
];
const annotations = syncAnnotations(rows, {});
for (const row of rows.slice(1)) for (const step of AUTHORED) {
  const field=step==='korean_blank'?'translation':'text';
  const span=tokenSpan(row[field],0,1,row.id);
  annotations[row.id].steps[step]={status:'confirmed', source:'teacher', targets:[{span, ...(step==='verb_form'?{hint:'student',answer:span.quote}:{}), ...(step==='grammar_choice'?{correct:span.quote,distractor:'incorrect'}:{})}]};
}
const input={title:'Canonical edit',workbookKey:'canonical-edit',rows,annotations,revision:1,requireConfirmed:true};
const before=compileStudio(input), original=structuredClone({rows,annotations,before});
const changed=structuredClone(rows); changed[17].text='Students study lesson 17 together every morning.';
const synced=syncAnnotations(changed,annotations);
assert.deepEqual(dirtyRows(changed,synced).map(row=>row.id),['sentence-17']);
assert.deepEqual(changed.map(row=>row.id),rows.map(row=>row.id));
for(const row of rows.slice(1)) {
  if(row.id==='sentence-17') for(const step of AUTHORED) assert.equal(synced[row.id].steps[step].status,'stale');
  else assert.deepEqual(synced[row.id],annotations[row.id],`${row.id}: unrelated confirmed targets must survive`);
}
assert.throws(()=>compileStudio({...input,rows:changed,annotations:synced,previousCatalog:before,revision:2}), /검토/);
const after=compileStudio({...input,rows:changed,annotations:synced,previousCatalog:before,revision:2,requireConfirmed:false});
for(const stage of after.stages) {
  const prior=before.stages.find(s=>s.stage===stage.stage);
  assert.equal(stage.items.length,PURE.includes(stage.semanticType)?20:19);
  for(const item of stage.items) {
    const old=prior.items.find(i=>i.key===item.key);
    assert.ok(old,'stable keys preserve existing learner item identity');
    if(item.provenance.canonicalSentenceId==='sentence-17') {
      assert.ok(PURE.includes(stage.semanticType));
      assert.notDeepEqual(item,old,'the edited sentence must regenerate');
      assert.equal(item.provenance.canonicalRevision,2);
      assert.match(item.provenance.snapshot,/study lesson 17/);
    } else if(PURE.includes(stage.semanticType)) assert.deepEqual(item,old,'unchanged PURE payloads must be retained verbatim');
    else {
      // Confirmed authored items are recompiled with the current revision.
      const meaning=({provenance,...rest})=>rest;
      assert.deepEqual(meaning(item),meaning(old),'unrelated authored meaning / target ranges must not change');
    }
  }
}
assert.deepEqual({rows,annotations,before},original,'compilation must not mutate the caller or the previous catalog');

// Existing split/merge contract: changed/new IDs need review; removed IDs retire.
const split=structuredClone(changed);
split.splice(17,1,{...changed[17],text:'Students study lesson 17 together.'},{id:'split-new',blockType:'SENTENCE',paragraphIndex:3,text:'They practice again every morning.',translation:'그들은 매일 아침 다시 연습한다.'});
const splitAnnotations=syncAnnotations(split,synced);
assert.deepEqual(dirtyRows(split,splitAnnotations).map(r=>r.id),['sentence-17','split-new']);
for(const step of AUTHORED) assert.equal(splitAnnotations['split-new'].steps[step].status,'needed');
const splitCatalog=compileStudio({...input,rows:split,annotations:splitAnnotations,previousCatalog:after,requireConfirmed:false,revision:3});
assert.equal(splitCatalog.stages.find(s=>s.semanticType==='writing').items.length,21);
const merged=structuredClone(changed); merged[17].text='Students study lesson 17 together. They practice again every morning.';
const mergeAnnotations=syncAnnotations(merged,splitAnnotations);
assert.equal(mergeAnnotations['split-new'].retired,true);
assert.deepEqual(mergeAnnotations['sentence-16'],annotations['sentence-16']);
assert.deepEqual(mergeAnnotations['sentence-18'],annotations['sentence-18']);
const mergedCatalog=compileStudio({...input,rows:merged,annotations:mergeAnnotations,previousCatalog:splitCatalog,requireConfirmed:false,revision:4});
assert.equal(mergedCatalog.stages.find(s=>s.semanticType==='writing').items.length,20);
assert.ok(mergedCatalog.stages.every(s=>s.items.every(i=>i.provenance.canonicalSentenceId!=='split-new')));
console.log('READY 20-sentence regression: sentence 17 only, confirmed annotations, PURE payloads, split/merge retirement.');
