import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {contracts,fixtureRoot,loadPdfFixture,selectedDrafts,rowDigest,rowMeaning,stageCounts,exerciseCounts,itemMeaning,semanticText,sha256,canonicalArtifact,catalogArtifact,expectPdfArtifact} from './helpers/ready-pdf-fixtures.mjs';
import {inspectStudioDocument} from '../server/ready/studio-import.mjs';
import {generateWorkbookCatalog,generatePassageDeterministicCatalog,alignPublisherBlankPrompt,validateSemanticWorkbookItem} from '../server/ready/workbook-factory.mjs';
import {publisherAnnotations,compileStudio} from '../server/ready/studio-authoring.mjs';
import {sentenceRows,AUTHORED,validateTargets,locateSpan} from '../ready/admin/studio-contract.js';
import {gradeLocalWorkbook} from '../ready/deterministic-grading.js';
import {workbookOrderAnswerIndexes,workbookOrderClick} from '../ready/workbook-interaction.js';

let validated=0,reviewed=0;
for(const contract of contracts.documents) {
  const {text,metadata}=await loadPdfFixture(contract);
  assert.equal((text.match(/\[PAGE \d+\]/g)||[]).length,contract.pages,contract.id);
  assert.doesNotMatch(text,/\uFFFD|ToUnicode|\u0000/,'decoded Unicode, not glyph bytes');
  const artifact={documentSha256:contract.sha256,kind:contract.kind,imported:[],reviewed:[]};
  if(contract.apiSlice){
    const slice=await loadPdfFixture({...contract,id:contract.id+'-slice',file:contract.apiSlice.file,sha256:contract.apiSlice.sha256});
    const bodies=value=>[...value.matchAll(/\[PAGE \d+\]([\s\S]*?)(?=\[PAGE \d+\]|$)/g)].map(m=>semanticText(m[1]));
    const originals=bodies(text),copied=bodies(slice.text);
    assert.deepEqual(copied,contract.apiSlice.originalPages.map(page=>originals[page-1]),'API slice must preserve the original page text without edits');
  }
  const all=inspectStudioDocument(text,metadata);
  assert.deepEqual(all.map(d=>d.number),contract.importLabels,`${contract.id}: passage boundaries / order`);
  const drafts=selectedDrafts(all,contract);
  assert.deepEqual(drafts.map(d=>d.number),contract.drafts.map(d=>d.number));
  if(contract.scope)assert.deepEqual(drafts.map(d=>d.number),contract.scope.available);
  for(let index=0;index<drafts.length;index++) {
    const d=drafts[index],expected=contract.drafts[index],label=`${contract.id}/${d.number}`;
    assert.equal(d.reviewRequired,expected.reviewRequired,label+' review gate');
    assert.equal(d.boundaryConfirmed,!d.reviewRequired,label);
    assert.equal(d.rows.length,expected.rawRowCount,label+' raw rows');
    assert.equal(d.sourceMetadata.documentSha256,contract.sha256);
    assert.equal(d.sourceMetadata.documentName,contract.documentName);
    assert.deepEqual([...new Set(d.sourceMetadata.pages)],expected.pages);
    assert.deepEqual(exerciseCounts(d.sourceExercises),expected.sourceExerciseCounts,label+' source extraction');
    if(contract.kind==='text')assert.deepEqual(d.sourceExercises,[],'text-only must not inherit full workbook assumptions');
    if(expected.blockedCanonical) {
      artifact.imported.push({number:d.number,status:'review_required',canonical:null,publisher:null,pure:null,reason:expected.reason});
      assert.equal(d.reviewRequired,true,'invalid canonical input must remain editable and unconfirmed');
      assert.throws(()=>generatePassageDeterministicCatalog({title:label,workbookKey:contract.id,rows:d.rows}),/Canonical|Deterministic validation/);
      continue;
    }
    assert.equal(rowDigest(d.rows),expected.canonical.digest,label+' ordered bilingual meaning (missing / duplicate / reordered sentence)');
    assert.deepEqual(rowMeaning(d.rows)[0],expected.canonical.first);
    assert.deepEqual(rowMeaning(d.rows).at(-1),expected.canonical.last);
    const catalog=generateWorkbookCatalog({title:label,workbookKey:contract.id,rows:d.rows,sourceExercises:d.sourceExercises,provenance:metadata});
    assert.deepEqual(stageCounts(catalog),expected.publisherStages,label+' publisher stage counts');
    assert.equal(catalog.metrics.unresolved,expected.unresolved,label+' explicit unresolved baseline');
    assert.equal(catalog.metrics.geminiCallCount,0);assert.equal(catalog.metrics.derivedFallbackExercises,0);
    assert.equal(catalog.source.documentSha256,contract.sha256);
    for(const stage of catalog.stages) {
      assert.equal(sha256(JSON.stringify(stage.items.map(itemMeaning))),expected.itemDigests[stage.semanticType],label+' '+stage.semanticType+' target meaning');
      for(const item of stage.items) {
        assert.equal(item.provenance.origin,'publisher_answer_key');
        assert.equal(validateSemanticWorkbookItem(stage.stage,item,new Map(d.rows.map((r,i)=>[i+1,r])),d.rows),'');
        assert.equal(gradeLocalWorkbook({mode:'deterministic',answers:item.answers},item.answers).correct,true);
        validated++;
      }
    }
    for(const {stage,...sample} of expected.samples) assert.deepEqual(itemMeaning(catalog.stages.find(s=>s.stage===stage).items.find(i=>i.number===sample.number)),sample,label+' representative target');
    const rows=d.rows.map((r,i)=>({...r,id:`pdf-${i+1}`,blockType:'SENTENCE'}));
    const annotations=publisherAnnotations(rows,d.sourceExercises,metadata);
    assert.deepEqual(Object.fromEntries(AUTHORED.map(step=>[step,rows.filter(row=>annotations[row.id].steps[step].source==='publisher').length])),expected.publisherAnnotationCounts,label+' publisher candidates must not silently disappear');
    for(const row of rows) for(const step of AUTHORED) {
      const record=annotations[row.id].steps[step];
      if(record.source!=='publisher')continue;
      assert.equal(record.status,'review','publisher candidates require teacher confirmation');
      validateTargets(row,step,record.targets);
      for(const target of record.targets) assert.ok(locateSpan(row[step==='korean_blank'?'translation':'text'],target.span));
    }
    const pure=generatePassageDeterministicCatalog({title:label,workbookKey:contract.id,rows});
    assert.deepEqual(pure.stages.filter(s=>s.items.length).map(s=>s.semanticType),['translation','word_order','writing']);
    assert.equal(pure.metrics.unresolved,0);
    artifact.imported.push(contract.kind==='text'?{number:d.number,status:'review_required',proposedCanonical:canonicalArtifact(rows),publisherSource:'none'}:{number:d.number,canonical:canonicalArtifact(rows),publisher:catalogArtifact(catalog),pure:catalogArtifact(pure),unresolved:catalog.metrics.unresolved,sourcePresence:'publisher'});
    for(const stage of pure.stages.filter(s=>s.items.length))assert.equal(stage.items.length,rows.length);
  }
  if(contract.reviewedFile) {
    const input=JSON.parse(readFileSync(resolve(process.env.READY_PDF_FIXTURE_DIR||fixtureRoot,contract.reviewedFile),'utf8'));
    assert.deepEqual(input.passages.map(p=>sentenceRows(p.rows).length),contract.reviewedCounts,'reviewed canonical sentence counts');
    const sourcePages=new Map([...text.matchAll(/\[PAGE (\d+)\]([\s\S]*?)(?=\[PAGE \d+\]|$)/g)].map(m=>[Number(m[1]),semanticText(m[2]).replace(/\s/g,'')]));
    for(const [passageIndex,passage] of input.passages.entries()) {
      assert.equal(rowDigest(passage.rows),contract.reviewed[passageIndex].digest,"reviewed meaning / pairing / order");
      assert.deepEqual(passage.rows.map(r=>[r.id,r.blockType,r.paragraphIndex??null,r.page]),contract.reviewed[passageIndex].layout,"structure and stable sentence IDs");
      const rows=sentenceRows(passage.rows);
      assert.equal(new Set(passage.rows.map(r=>r.id)).size,passage.rows.length,'unique stable canonical IDs');
      for(const row of rows) for(const field of ['text','translation']) assert.ok(sourcePages.get(row.page).includes(semanticText(row[field]).replace(/\s/g,'')),`${contract.id}/${row.id}/${field}: reviewed text must be present on the original PDF page`);
      const catalog=compileStudio({title:passage.title,workbookKey:contract.id,rows:passage.rows,annotations:{},provenance:metadata});
      assert.equal(catalog.metrics.unresolved,0);
      for(const stage of catalog.stages)assert.equal(stage.items.length,AUTHORED.includes(stage.semanticType)?0:rows.length,'TITLE/SUBTITLE must never become Workbook items');
      for(const item of catalog.stages.find(s=>s.semanticType==='word_order').items) {
        const group=item.groups[0],answer=item.answers[0],indexes=workbookOrderAnswerIndexes(group,answer);
        assert.equal(indexes.length,group.length);assert.equal(new Set(indexes).size,group.length,'duplicate token identities must not collapse');
        let result={chosen:[],consumed:[]};for(const index of indexes)result=workbookOrderClick(group,answer,result.chosen,result.consumed,index);
        assert.equal(result.type,'correct');assert.equal(result.chosen.length,group.length);
      }
      assert.deepEqual(catalog.stages.find(s=>s.semanticType==='writing').items.map(i=>i.answers[0]),rows.map(r=>r.text));
      reviewed+=rows.length;
      artifact.reviewed.push({number:passage.number||'',title:passage.title,canonical:canonicalArtifact(passage.rows),pure:catalogArtifact(catalog),publisherSource:'none'});
    }
    if(contract.scope)assert.deepEqual(input.passages.map(p=>p.number),contract.scope.available,'21-40 scope must survive reviewed passage creation');
  }
  await expectPdfArtifact(contract,'factory',artifact);
  console.log(`PASS PDF ${contract.id}: ${contract.pages} pages, ${drafts.length} draft(s)`);
}
// Geometry-sensitive repeated answers: replacing the first matching token twice
// would erase the unblanked occurrence and must fail this test.
assert.equal(alignPublisherBlankPrompt('They move, then _____ and _____.',['move','move'],'They move, then move and move.'),'They move, then ______________ and ______________.');
assert.equal(alignPublisherBlankPrompt('They _____ and _____.',['move','stop'],'They move and move.'),'','wrong answer-key evidence must fail closed');
console.log(`READY real PDFs: ${validated} publisher items; ${reviewed} reviewed text-only canonical rows; explicit blocked / unresolved baselines retained.`);
