import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractSentenceRows, generatePassageDeterministicCatalog } from '../server/ready/workbook-factory.mjs';

const visualImageryTsv = `Humans excel at visual imagery.\t인간은 시각적 심상에 뛰어나다.
Our brains evolved this ability to create an internal mental picture or model of the world in which we can rehearse forthcoming actions, without the risks or the penalties of doing them in the real world.\t우리의 뇌는 실제 세계에서 그것들을 행하는 위험이나 불이익 없이, 다가올 행동들을 예행 연습할 수 있는 세계의 내적 정신적 그림 혹은 모델을 만들어내는 이 능력을 진화시켰다.
There are even hints from brain-imaging studies by Harvard University psychologist Steve Kosslyn showing that your brain uses the same regions to imagine a scene as when you actually view one.\t심지어 당신의 뇌가 장면을 상상하기 위해 당신이 실제로 장면을 볼 때와 같은 영역을 사용하는 것을 보여주는 Harvard 대학교 심리학자 Steve Kosslyn에 의한 뇌 영상 연구로부터 나온 단서도 있다.
But evolution has seen to it that such internally generated representations are never as authentic as the real thing.\t그러나 진화는 그러한 내적으로 생성된 표상들이 결코 실제만큼 진짜일 수는 없도록 해 왔다.
This is a wise bit of self-restraint on your genes' part.\t이것은 당신의 유전자 편에서는 하나의 지혜로운 자기 절제이다.
If your internal model of the world were a perfect substitute, then anytime you felt hungry you could simply imagine yourself at a banquet, consuming a feast.\t만약 세계에 대한 당신의 내적 모델이 완벽한 대체물이라면, 당신이 언제든 배고픔을 느낄 때 연회에서 당신 자신이 진수성찬을 먹는 것을 단순히 상상할 것이다.
You would have no incentive to find real food and would soon starve to death.\t당신은 실제 음식을 찾을 동기가 전혀 없게 되고 곧 굶어 죽게 될 것이다.
As the Bard said, “You cannot cloy the hungry edge of appetite by bare imagination of a feast.“\tBard가 말했듯, “진수성찬에 대한 있는 그대로의 상상으로 식욕의 굶주린 날을 배 불릴 수 없다.“`;
const extracted = extractSentenceRows(visualImageryTsv);
assert.equal(extracted.pairing, 'tsv_two_column');
assert.equal(extracted.rows.length, 8);

const rows = [
  {id:'title-1',blockType:'TITLE',text:'Visual Imagery',translation:''},
  {id:'subtitle-1',blockType:'SUBTITLE',text:'Mental rehearsal',translation:''},
  {id:'sentence-1',blockType:'SENTENCE',paragraphIndex:0,text:'Humans excel at visual imagery.',translation:'인간은 시각적 심상에 뛰어나다.'},
  {id:'sentence-2',blockType:'SENTENCE',paragraphIndex:0,text:'Our brains evolved this ability to create an internal mental picture.',translation:'우리의 뇌는 내적 정신적 그림을 만드는 능력을 진화시켰다.'},
  {id:'sentence-3',blockType:'SENTENCE',paragraphIndex:1,text:'There are even hints from brain-imaging studies.',translation:'뇌 영상 연구에서 나온 단서도 있다.'},
];
const catalog=generatePassageDeterministicCatalog({title:'Fixture',workbookKey:'fixture',rows,provenance:{canonicalRevision:2}});
assert.equal(catalog.metrics.geminiCallCount,0);
assert.equal(catalog.metrics.unresolved,0);
assert.deepEqual(catalog.stages.filter(stage=>stage.items.length).map(stage=>stage.stage),[3,6,7]);
for(const stage of catalog.stages.filter(stage=>[3,6,7].includes(stage.stage)))assert.equal(stage.items.length,3);
assert.equal(JSON.stringify(catalog).includes('Visual Imagery'),false,'TITLE must not become a Workbook sentence.');
assert.equal(JSON.stringify(catalog).includes('Mental rehearsal'),false,'SUBTITLE must not become a Workbook sentence.');
for(const item of catalog.stages.find(stage=>stage.stage===6).items)assert.ok(item.groups[0].every(chip=>!(/\s/.test(chip))));
for(const item of catalog.stages.find(stage=>stage.stage===7).items)assert.equal(item.answers.length,1);
const regenerated=generatePassageDeterministicCatalog({title:'Fixture',workbookKey:'fixture',rows:[rows[0],rows[1],rows[4],rows[2],rows[3]],previousCatalog:catalog,provenance:{canonicalRevision:3}});
assert.equal(regenerated.stages.find(stage=>stage.stage===7).items.find(item=>item.provenance.canonicalSentenceId==='sentence-1').key,catalog.stages.find(stage=>stage.stage===7).items[0].key,'stable sentence identity preserves progress keys after reorder.');
const admin = readFileSync(new URL('../ready/admin/app.js', import.meta.url), 'utf8');
const student = readFileSync(new URL('../ready/app.js', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../server/ready/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260906114040_ready_live_passage_editor.sql', import.meta.url), 'utf8');
for (const control of ['data-canonical-split','data-canonical-merge','data-canonical-add','data-canonical-delete','data-factory-split','data-factory-merge','data-factory-move']) assert.match(admin,new RegExp(control));
assert.match(admin,/모든 지문 Deterministic 다시 생성/);
assert.match(edge,/savePassageCanonical[\s\S]*regenerateDeterministicPassage/);
assert.doesNotMatch(edge.match(/async function regenerateDeterministicPassage[\s\S]*?async function savePassageCanonical/)?.[0]||'',/Gemini|callGemini|geminiSentenceJson/);
assert.match(migration,/canonical_revision[\s\S]*ai_regeneration_required[\s\S]*ready_publish_deterministic_catalog/);
assert.doesNotMatch(student,/오늘도 한 지문씩/);
assert.match(student,/state\.resume\?`<section class="student-resume"/);
console.log('READY deterministic Workbook check passed.');
