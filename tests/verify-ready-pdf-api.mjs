import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {contracts,fixtureRoot,loadPdfFixture,sha256,canonicalArtifact,catalogArtifact,expectPdfArtifact} from './helpers/ready-pdf-fixtures.mjs';
import {pg,call,admin,aiCalls,close} from './helpers/ready-studio-api.mjs';
import {AUTHORED,sentenceRows} from '../ready/admin/studio-contract.js';
import {gradeLocalWorkbook} from '../ready/deterministic-grading.js';
import {verifierMatches,workbookRecallCue,livePrefixState} from '../ready/workbook-assistance.js';

try {
  const studentId=crypto.randomUUID(),token='pdf-regression-local-student-session';
  await pg.query("insert into ready_students(id,name,school,grade) values($1,'PDF regression','test2','2학년')",[studentId]);
  const examId=(await pg.query("select id from ready_exams where school='test2' and grade='2학년' and is_current=true")).rows[0].id;
  await pg.query("insert into ready_sessions(token_hash,actor_type,student_id,expires_at) values($1,'student',$2,now()+interval '1 day')",[sha256(token),studentId]);
  let published=0;
  for(const contract of contracts.documents) {
    const {bytes}=await loadPdfFixture(contract);
    let body={title:contract.title,sourceKind:'pdf',pdfBase64:bytes.toString('base64'),documentName:contract.documentName,sourceType:contract.id.startsWith('mock-')?'MOCK_EXAM':'TEXTBOOK',grade:'2학년',sourceYear:2026,sourceMonth:contract.id.includes('september')?9:6};
    const beforeJobs=(await pg.query('select count(*)::integer as n from ready_workbook_factory_jobs')).rows[0].n;
    if(body.pdfBase64.length>10000000) {
      await assert.rejects(()=>call('studio_import',body,admin),e=>e.status===413&&/7MB/.test(e.message),'the full 11MB June file must respect the existing API size limit');
      assert.equal((await pg.query('select count(*)::integer as n from ready_workbook_factory_jobs')).rows[0].n,beforeJobs,'oversize import must not partially create jobs');
      console.log('PASS PDF API '+contract.id+': 413 / zero writes (full bytes tested by parser suite)');
      const sliceBytes=readFileSync(resolve(process.env.READY_PDF_FIXTURE_DIR||fixtureRoot,contract.apiSlice.file));
      assert.equal(sha256(sliceBytes),contract.apiSlice.sha256);
      body={...body,pdfBase64:sliceBytes.toString('base64'),documentName:contract.apiSlice.file};
    }
    const imported=await call('studio_import',body,admin);
    if(!contract.apiSlice)assert.equal(imported.drafts.length,contract.importLabels.length);assert.equal(imported.aiCallCount,0);
    const artifact={documentSha256:contract.sha256,apiSource:contract.apiSlice||{file:contract.file,sha256:contract.sha256},passages:[]};
    let inputs=imported.drafts.map((d,i)=>({job:d.job,rows:d.rows,title:d.job.title,number:contract.apiSlice?(d.job.title.match(/(\d+)번$/)?.[1]||''):contract.importLabels[i]}));
    for(const d of imported.drafts) {
      assert.equal(d.job.source_metadata.documentSha256,contract.apiSlice?.sha256||contract.sha256);
      assert.equal(d.job.source_metadata.documentName,body.documentName);
      if(contract.kind==='text') {
        assert.equal(d.boundaryConfirmed,false,'plain text needs explicit boundary review');
        assert.deepEqual(d.job.extraction.sourceExercises,[]);
      }
    }
    if(contract.apiSlice){inputs=inputs.filter(d=>d.number===contract.apiSlice.number);assert.equal(inputs.length,1);}
    if(contract.reviewedFile) {
      const reviewed=JSON.parse(readFileSync(resolve(process.env.READY_PDF_FIXTURE_DIR||fixtureRoot,contract.reviewedFile),'utf8'));
      if(imported.drafts.length===1&&reviewed.passages.length>1) {
        inputs=[];
        for(const p of reviewed.passages) {
          const split=await call('studio_split_draft',{jobId:imported.drafts[0].job.id,title:p.title,rows:p.rows},admin);
          assert.equal(split.job.source_metadata.documentSha256,contract.sha256);
          inputs.push({job:split.job,rows:p.rows,title:p.title});
        }
      }else inputs=inputs.map(d=>({...d,rows:reviewed.passages.find(p=>p.number===d.number).rows}));
    }
    for(const d of inputs) {
      await assert.rejects(()=>call('studio_create_draft',{jobId:d.job.id,title:d.title,rows:d.rows,boundaryConfirmed:false},admin),e=>e.status===422);
      const {passageId}=await call('studio_create_draft',{jobId:d.job.id,title:d.title,rows:d.rows,boundaryConfirmed:true},admin);
      let context=await call('studio_open',{passageId},admin);
      const publisherCandidateCounts=Object.fromEntries(AUTHORED.map(step=>[step,sentenceRows(context.rows).filter(r=>context.studio.annotations[r.id].steps[step].source==='publisher').length]));
      assert.equal(sentenceRows(context.rows).length,sentenceRows(d.rows).length);
      assert.deepEqual(context.rows.map(r=>[r.blockType,r.text,r.translation,r.paragraphIndex]),d.rows.map(r=>[r.blockType||'SENTENCE',r.text,r.translation,r.paragraphIndex||0]),'canonical create must preserve reviewed title/subtitle/paragraph structure');
      const invoke=(op,data={})=>call(op,{passageId,revision:context.passage.canonical_revision,version:context.studio.version,...data},admin);
      assert.equal((await pg.query('select count(*)::integer as n from ready_workbook_catalogs where passage_id=$1',[passageId])).rows[0].n,0,'a draft is not a published workbook');
      let result=await invoke('studio_publish',{step:'writing'});context.studio=result.studio;
      for(const stage of [3,6,7])assert.equal(result.catalog.stages.find(s=>s.stage===stage).items.length,sentenceRows(d.rows).length);
      // Simulate teacher confirmation only of validated publisher candidates.
      // Explicit empty targets are the current product contract for no candidate.
      for(const step of AUTHORED) {
        if(!sentenceRows(context.rows).some(r=>context.studio.annotations[r.id].steps[step].source==='publisher'))continue;
        result=await invoke('studio_confirm_step',{step,confirmations:sentenceRows(context.rows).map(row=>({sentenceId:row.id,targets:context.studio.annotations[row.id].steps[step].targets}))});context.studio=result.studio;
        result=await invoke('studio_publish',{step});context.studio=result.studio;
      }
      const catalog=result.catalog;
      assert.equal(catalog.source.documentSha256,contract.apiSlice?.sha256||contract.sha256);
      const workbook=await call('student_workbook',{examId,passageId},token);
      artifact.passages.push({number:d.number||'',canonical:canonicalArtifact(context.rows),studioCatalog:catalogArtifact(catalog),studentCatalog:catalogArtifact(workbook,{student:true,sourceCatalog:catalog}),publisherCandidateCounts});
      for(const stage of workbook.stages) {
        const expected=catalog.stages.find(s=>s.stage===stage.stage);
        assert.equal(stage.items.length,expected.items.length);
        const item=stage.items[0],answer=expected.items[0]?.answers;
        if(!item)continue;
        if(item.semanticType==='translation')continue; // AI grading is separately stubbed, not claimed here.
        assert.deepEqual(item.grading.answers,answer);
        assert.equal(gradeLocalWorkbook(item.grading,answer).correct,true);
        if(['korean_blank','english_blank'].includes(item.semanticType)) {
          const mode=item.assistance.recallMode;
          assert.equal(await verifierMatches(workbookRecallCue(answer[0],mode),item.assistance.slots[0]),true);
          assert.equal(await verifierMatches('__wrong__',item.assistance.slots[0]),false);
        }
        if(item.semanticType==='writing') {
          assert.equal(item.assistance.mode,'prefix_typing');
          assert.equal((await livePrefixState(answer[0],item.assistance.slots[0])).complete,true);
          assert.equal((await livePrefixState(answer[0]+' incorrect',item.assistance.slots[0])).valid,false);
        }
      }
      // Real Student submission + idempotent transport retry; read-only retrieval
      // and draft review above must never create attempts themselves.
      const item=workbook.stages.find(s=>s.stage===7).items[0];
      const request={examId,passageId,itemKey:item.key,responses:item.grading.answers,clientAttemptId:crypto.randomUUID()};
      const attemptsBefore=(await pg.query('select count(*)::integer as n from ready_workbook_attempts')).rows[0].n;
      assert.equal(attemptsBefore,published,'import / review / Student reads must not create attempts');
      const first=await call('submit_workbook_attempt',request,token);
      assert.equal(first.correct,true);
      const retry=await call('submit_workbook_attempt',request,token);assert.equal(retry.correct,true);
      assert.equal((await pg.query('select count(*)::integer as n from ready_workbook_attempts')).rows[0].n,attemptsBefore+1);
      published++;
    }
    await expectPdfArtifact(contract,'student',artifact);
    assert.equal(aiCalls.length,0,'PDF -> review -> PURE/publisher -> Student must never invoke AI');
    console.log(`PASS PDF API ${contract.id}: ${inputs.length} reviewed passage(s) published and read by Student`);
  }
  assert.equal(published,26,'3 full textbook drafts + 1 June excerpt + 2 YBM passages + September 21-40');
  console.log('READY real PDF -> API -> PostgreSQL -> Studio -> Student: 26 passages, source hashes, actual grading and idempotent attempts.');
} finally {await close();}
