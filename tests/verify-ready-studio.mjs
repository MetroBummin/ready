import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AUTHORED,spanTokens,makeSpan,locateSpan,snapshot,syncAnnotations,dirtyRows,applyCandidates,validateTargets} from '../ready/admin/studio-contract.js';
import {compileStudio,publisherAnnotationAudit} from '../server/ready/studio-authoring.mjs';
import {inspectStudioDocument} from '../server/ready/studio-import.mjs';
const text=readFileSync(new URL('./fixtures/studio/september-2026.txt',import.meta.url),'utf8');
const drafts=inspectStudioDocument(text,{title:'2026년 9월 고2',documentSha256:'file-a'});
assert.equal(drafts.length,4);assert.deepEqual(drafts.map(d=>d.rows.length),[9,8,8,8]);
assert.deepEqual(drafts.map(d=>d.number),['21','22','23','24']);
assert.ok(drafts[0].rows.every(r=>!r.text.includes('always on')));
const other=inspectStudioDocument(text,{documentSha256:'file-b'});
assert.equal(drafts[0].sourceMetadata.documentSha256,'file-a');assert.equal(other[0].sourceMetadata.documentSha256,'file-b');
const ambiguous=inspectStudioDocument('[PAGE 1]\n21번\n22번\nPeople learn from others.\n사람들은 다른 사람에게서 배운다.');assert.equal(ambiguous[0].boundaryConfirmed,false);
const rows=[{id:'title',blockType:'SUBTITLE',text:'Through Peer Pressure',translation:''},...drafts[0].rows.slice(0,3).map((r,i)=>({...r,id:`sentence-${i+1}`}))];
let annotations=syncAnnotations(rows,{});
assert.equal(Object.keys(annotations).length,3);
for(const row of rows.slice(1))for(const step of AUTHORED){const field=step==='korean_blank'?'translation':'text',start=0,end=spanTokens(row[field])[0].end,span=makeSpan(row[field],start,end,row.id);annotations[row.id].steps[step]={status:'confirmed',targets:[{span,...(step==='verb_form'?{hint:'be',answer:span.quote}:{}),...(step==='grammar_choice'?{correct:span.quote,distractor:'Incorrect'}:{})}]};}
const catalog=compileStudio({rows,annotations,title:'Fixture',workbookKey:'fixture',requireConfirmed:true});
assert.deepEqual(catalog.stages.map(s=>s.stage),[1,2,3,4,5,6,7]);assert.equal(catalog.metrics.geminiCallCount,0);
assert.ok(catalog.stages.every(s=>s.items.length===3));assert.ok(!JSON.stringify(catalog).includes('Through Peer Pressure'));
const changed=structuredClone(rows);changed[2].text+=' Today.';
const dirty=syncAnnotations(changed,annotations);assert.deepEqual(dirty['sentence-1'],annotations['sentence-1']);assert.deepEqual(dirtyRows(changed,dirty).map(r=>r.id),['sentence-2']);
assert.throws(()=>compileStudio({rows:changed,annotations:dirty,title:'Fixture',workbookKey:'fixture',requireConfirmed:true}));
const stageAnnotations=structuredClone(dirty);stageAnnotations['sentence-2'].steps.english_blank.status='confirmed';
const stagePublish=compileStudio({rows:changed,annotations:stageAnnotations,title:'Fixture',workbookKey:'fixture',previousCatalog:catalog,revision:2,requireConfirmed:true,publishStep:'english_blank'});
assert.deepEqual(stagePublish.stages.find(stage=>stage.semanticType==='korean_blank').items,catalog.stages.find(stage=>stage.semanticType==='korean_blank').items,'publishing one stage must preserve other authored stages');
const partial=compileStudio({rows:changed,annotations:dirty,title:'Fixture',workbookKey:'fixture',previousCatalog:catalog,revision:2});
assert.equal(partial.stages[0].items.length,2);assert.deepEqual(partial.stages[2].items[0],catalog.stages[2].items[0]);
assert.equal(partial.stages[2].items[1].key,catalog.stages[2].items[1].key);
const reordered=compileStudio({rows:[rows[0],rows[3],rows[1],rows[2]],annotations,title:'Fixture',workbookKey:'fixture',previousCatalog:catalog});
assert.equal(reordered.stages[2].items[1].key,catalog.stages[2].items[0].key);assert.equal(new Set(reordered.stages[2].items.map(i=>i.key)).size,3);
const contractionRow={id:'contraction-row',blockType:'SENTENCE',active:true,text:"I'm standing here.",translation:'나는 여기 서 있다.'};
const contractionAnnotations=syncAnnotations([contractionRow],{});
for(const stage of AUTHORED)contractionAnnotations[contractionRow.id].steps[stage]={status:'confirmed',source:'teacher',targets:[]};
contractionAnnotations[contractionRow.id].steps.verb_form={status:'confirmed',source:'teacher',targets:[{span:makeSpan(contractionRow.text,1,12,contractionRow.id),hint:'be, stand',answer:'am standing'}]};
const contractionCatalog=compileStudio({rows:[contractionRow],annotations:contractionAnnotations,title:'Contraction',workbookKey:'contraction',requireConfirmed:true,publishStep:'verb_form'});
const contractionItem=contractionCatalog.stages.find(stage=>stage.semanticType==='verb_form').items[0];
const letsRow={id:'lets-row',blockType:'SENTENCE',text:"Let's find out whether it works.",translation:'그것이 작동하는지 알아보자.'};
const letsSource=[{type:'verb_form',number:1,prompt:'______________ us ______________ out whether it ______________.',answers:['Let','find','works'],hints:['Let','find','work'],canonicalStart:1,canonicalEnd:1,provenance:{origin:'publisher_answer_key'}}];
const letsAudit=publisherAnnotationAudit([letsRow],letsSource,{documentName:'Expanded contraction'});
assert.deepEqual(letsAudit.drops,[],'Expanded publisher Let us must align to canonical Let\'s without losing the verb-form row.');
assert.equal(letsAudit.annotations[letsRow.id].steps.verb_form.targets.length,3);
const apostropheSRow={id:'apostrophe-s-row',blockType:'SENTENCE',text:"It's absolutely ready for the final review.",translation:'그것은 최종 검토를 위해 완전히 준비되었다.'};
const apostropheSAnnotations=syncAnnotations([apostropheSRow],{});
for(const stage of AUTHORED)apostropheSAnnotations[apostropheSRow.id].steps[stage]={status:'confirmed',source:'teacher',targets:[]};
apostropheSAnnotations[apostropheSRow.id].steps.verb_form={status:'confirmed',source:'teacher',targets:[{span:makeSpan(apostropheSRow.text,2,4,apostropheSRow.id),hint:'be',answer:'is'}]};
const apostropheSCatalog=compileStudio({rows:[apostropheSRow],annotations:apostropheSAnnotations,title:'Apostrophe S',workbookKey:'apostrophe-s',requireConfirmed:true,publishStep:'verb_form'});
assert.equal(apostropheSCatalog.stages.find(stage=>stage.semanticType==='verb_form').items[0].prompt,'It _____ absolutely ready for the final review.');
assert.equal(contractionItem.prompt,'I _____ here.');assert.deepEqual(contractionItem.answers,['am standing']);
const removed=syncAnnotations([rows[0],rows[1],rows[3]],annotations);assert.equal(removed['sentence-2'].retired,true);assert.deepEqual(removed['sentence-1'],annotations['sentence-1']);
const split=syncAnnotations([rows[0],rows[1],{...rows[2],id:'new-split'},rows[3]],annotations);assert.equal(split['new-split'].steps.english_blank.status,'needed');assert.equal(split['sentence-2'].retired,true);
const repeated='one word and one word';const span=makeSpan(repeated,13,21);assert.deepEqual(locateSpan(repeated,span),{start:13,end:21});
assert.equal(locateSpan('one word and one word',{quote:'one word'}),null);
assert.throws(()=>validateTargets(rows[1],'grammar_choice',[{span:makeSpan(rows[1].text,0,1,rows[1].id),correct:'A',distractor:'a'}]));
const candidates=applyCandidates(rows,annotations,[{sentenceId:'sentence-1',english_blank:[]}]);assert.deepEqual(candidates['sentence-1'],annotations['sentence-1'],'AI never changes confirmed annotations');
const fresh=syncAnnotations(rows,{}),invalid=applyCandidates(rows,fresh,[{sentenceId:'sentence-1',english_blank:[{start:-1,end:20000}]}]);assert.equal(invalid['sentence-1'].steps.english_blank.status,'needed');
const backend=readFileSync(new URL('../server/ready/index.ts',import.meta.url),'utf8');
assert.doesNotMatch(backend.match(/async function studioImport[\s\S]*?async function studioSplitDraft/)[0],/geminiSentenceJson/);
assert.doesNotMatch(backend.match(/async function regenerateDeterministicPassage[\s\S]*?async function savePassageCanonical/)[0],/geminiSentenceJson/);
const studioUi=readFileSync(new URL('../ready/admin/studio-ui.js',import.meta.url),'utf8');
assert.match(studioUi,/\['blank_pair','verb_form','grammar_choice'\]/,'English and Korean blank review must share one UI step');
assert.match(studioUi,/if\(PURE\.includes\(step\)\)[\s\S]*studio_preview/,'AUTO chips must open Student Preview directly');
assert.match(studioUi,/workbookWritingHtml/,'Writing Preview must reuse the production writing component');
assert.doesNotMatch(studioUi,/PURE\.includes\(step\)\?['"]<p class="empty"/,'AUTO must not show an intermediate explanation screen');
assert.match(backend,/for\(let offset=0;offset<needed\.length;offset\+=8\)/,'Gemini authoring must use bounded batches');

const publisherRows=[
  {id:'publisher-1',blockType:'SENTENCE',text:"First man's story is clear.",translation:'첫 번째 이야기는 매우 분명하다.'},
  {id:'publisher-2',blockType:'SENTENCE',text:'Second "quoted" line works.',translation:'두 번째 인용 문장도 작동한다.'},
];
const publisherSource=[
  {type:'korean_blank',number:1,prompt:'첫 번째 ______________ ______________ 분명하다.',answers:['이야기는','매우'],answer:'이야기는 / 매우',canonicalStart:1,canonicalEnd:1,provenance:{origin:'publisher_answer_key'}},
  {type:'verb_form',number:1,prompt:'First man’s story ______________ clear.',answers:['is'],hints:['be'],answer:'is',canonicalStart:1,canonicalEnd:1,provenance:{origin:'publisher_answer_key'}},
  {type:'grammar_vocab_choice',number:1,prompt:'First ⟦CHOICE:0⟧ story is clear. Second "⟦CHOICE:1⟧" line works.',answers:["man's",'quoted'],groups:[["man's",'mans'],['quoted','quoting']],canonicalStart:1,canonicalEnd:2,provenance:{origin:'publisher_answer_key'}},
];
const publisherAudit=publisherAnnotationAudit(publisherRows,publisherSource,{documentName:'Publisher mapping regression'});
assert.deepEqual(publisherAudit.drops,[],'Publisher conversion errors must be observable and the supported fixture must not drop.');
assert.equal(publisherAudit.annotations['publisher-1'].steps.korean_blank.targets.length,2,'Adjacent publisher blanks must resolve by their exact answers.');
assert.equal(publisherAudit.annotations['publisher-1'].steps.verb_form.source,'publisher','Smart apostrophes in the publisher frame must match canonical punctuation.');
assert.equal(publisherAudit.annotations['publisher-1'].steps.grammar_choice.targets.length,1,'A multi-sentence publisher item must map its first target to the first canonical sentence.');
assert.equal(publisherAudit.annotations['publisher-2'].steps.grammar_choice.targets.length,1,'A multi-sentence publisher item must map its second target to the second canonical sentence.');
console.log('READY Studio: real September batch, spans, confirmations, dirty scope, stable keys and AI boundaries passed.');

const {selectToken}=await import('../ready/admin/studio-selection.js');
let selection=selectToken([],null,2);
selection=selectToken(selection.targets,selection.activeIndex,3);
selection=selectToken(selection.targets,selection.activeIndex,4);
assert.deepEqual(selection.targets[0].span,{tokenStart:2,tokenEnd:5});
selection=selectToken(selection.targets,selection.activeIndex,4);
assert.deepEqual(selection.targets[0].span,{tokenStart:2,tokenEnd:4});
selection=selectToken(selection.targets,selection.activeIndex,8);
assert.equal(selection.targets.length,2);assert.equal(selection.activeIndex,1);
selection=selectToken(selection.targets,selection.activeIndex,7);
assert.deepEqual(selection.targets[1].span,{tokenStart:7,tokenEnd:9});
console.log('Shared token-span interaction: adjacent expansion, endpoint shrink, separate target passed.');
