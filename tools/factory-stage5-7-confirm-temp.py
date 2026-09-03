from pathlib import Path

# 1) Workbook parser: normalize Let's/Let us and rescue Stage 7 answers
# that PDF text extraction places outside the repeated Stage 7 heading.
path=Path('server/ready/workbook-factory.mjs')
text=path.read_text()
needle="  .replace(/\\b(he|she|it)'s\\b/g, '$1 is')\n"
if needle not in text: raise SystemExit('comparableEnglish marker missing')
text=text.replace(needle, needle+"  .replace(/\\blet's\\b/g, 'let us')\n", 1)

start=text.index('function stage7AnswerItems(text) {')
end=text.index('function literalOccurrences(value, needle) {', start)
replacement=r'''function stage7AnswerPart(value) {
  return canonicalText(String(value ?? '')
    .replace(/\[PAGE\s+\d+\]/gi, ' ')
    .replace(/[가-힣]+/g, ' ')
    .replace(/\bLesson\s+\d+\b/gi, ' ')
    .replace(/\bAnswer\s*Key\b/gi, ' ')
    .replace(/[│◗]/g, ' ')
    .replace(/\s+-\s*\d+\s*-\s+/g, ' '));
}
function stage7PairsFromBlock(value) {
  return [...String(value ?? '').matchAll(/\((\d+)\)\s*([\s\S]*?)\s*(?:→|->|⇒)\s*([\s\S]*?)(?=\(\d+\)\s*|$)/g)]
    .map(match => [stage7AnswerPart(match[2]), stage7AnswerPart(match[3])])
    .filter(pair => pair[0] && pair[1] && !sameOption(pair[0], pair[1]));
}
function stage7AnswerItems(text) {
  const answerAt = text.search(/Answer\s*Key/i); if (answerAt < 0) return [];
  const answerText = text.slice(answerAt), output = [];
  const add = (family, number, value) => {
    const pairs = stage7PairsFromBlock(value);
    if (pairs.length >= 2 && pairs.length <= 4) output.push({ family, number, pairs });
  };
  const markers = [...answerText.matchAll(/워크북\s*7\s*어색한 곳 찾기 연습[^\n]*/g)];
  for (const marker of markers) {
    const following = answerText.slice(marker.index + marker[0].length), nextStage = following.search(/워크북\s*8(?:\D|$)/), block = following.slice(0, nextStage >= 0 ? nextStage : following.length), headings = [...block.matchAll(/(문맥상|어법상)\s*어색한 것 찾기/g)];
    for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
      const family = headings[headingIndex][1] === '문맥상' ? 'context' : 'grammar', from = headings[headingIndex].index + headings[headingIndex][0].length, to = headingIndex + 1 < headings.length ? headings[headingIndex + 1].index : block.length, section = block.slice(from, to), starts = [...section.matchAll(/(?:^|\n)\s*(\d+)\)\s*\(1\)\s*/g)];
      for (let index = 0; index < starts.length; index += 1) {
        const number = Number(starts[index][1]), begin = starts[index].index + starts[index][0].length, finish = index + 1 < starts.length ? starts[index + 1].index : section.length;
        add(family, number, `(1) ${section.slice(begin, finish)}`);
      }
    }
  }
  // PDF text layers can emit a continuation column before the repeated
  // "워크북 7" heading on the next answer-key page. Rescue every numbered
  // arrow-pair block globally, then let the canonical round-trip below decide
  // which context/grammar prompt it belongs to. This stays fail-closed.
  const starts = [...answerText.matchAll(/(?:^|\n)\s*(\d+)\)\s*\(1\)\s*/g)];
  for (let index = 0; index < starts.length; index += 1) {
    const number = Number(starts[index][1]), begin = starts[index].index + starts[index][0].length, finish = index + 1 < starts.length ? starts[index + 1].index : answerText.length;
    add('', number, `(1) ${answerText.slice(begin, finish)}`);
  }
  const unique = new Map(output.map(item => [`${item.family}:${item.number}:${JSON.stringify(item.pairs)}`, item]));
  return [...unique.values()];
}
'''
text=text[:start]+replacement+text[end:]
old="for (const answerItem of answers.filter(item => item.family === promptItem.family && item.number === promptItem.number)) {"
new="for (const answerItem of answers.filter(item => item.number === promptItem.number && (!item.family || item.family === promptItem.family))) {"
if old not in text: raise SystemExit('stage7 family filter missing')
text=text.replace(old,new,1)
path.write_text(text)

# 2) Server: preview first, explicit finalization second. Full-workbook
# upload must never create the Passage automatically.
path=Path('server/ready/index.ts')
text=path.read_text()
old='async function finalizeFactoryJob(job: any, confirmedRows?: unknown, allowIncomplete = false, replaceExistingCatalog = false, useAiFallback = true) {'
new='async function finalizeFactoryJob(job: any, confirmedRows?: unknown, allowIncomplete = false, replaceExistingCatalog = false, useAiFallback = true, previewOnly = false) {'
if old not in text: raise SystemExit('finalize signature missing')
text=text.replace(old,new,1)
marker='''  previewCatalog = generateWorkbookCatalog({ title: `${title} · READY 워크북`, workbookKey: previewKey, rows: rowsForCatalog, ai: ai.stages, sourceExercises, provenance, allowDerivedFallback: true });
  if (previewCatalog.metrics.incompleteStages.length && !allowIncomplete) {'''
replacement='''  previewCatalog = generateWorkbookCatalog({ title: `${title} · READY 워크북`, workbookKey: previewKey, rows: rowsForCatalog, ai: ai.stages, sourceExercises, provenance, allowDerivedFallback: true });
  if (previewOnly) {
    if (!replaceExistingCatalog) {
      const reviewed = await db.from("ready_workbook_factory_jobs").update({ status: "review_required", extracted_rows: rowsForCatalog, metrics: previewCatalog.metrics, failure_reason: "" }).eq("id", job.id);
      if (reviewed.error) throw new ApiError(500, reviewed.error.message);
    }
    return { confirmationRequired: true, incompleteReview: previewCatalog.metrics.incompleteStages.length > 0, metrics: previewCatalog.metrics };
  }
  if (previewCatalog.metrics.incompleteStages.length && !allowIncomplete) {'''
if marker not in text: raise SystemExit('preview insertion marker missing')
text=text.replace(marker,replacement,1)
auto_start='''  // A full workbook only bypasses the human checkpoint after the parser has
  // deterministic bilingual evidence. It still uses the same final validator.
  if (!existingMode && inspected.fullWorkbook && !inspected.reviewRequired) {
    const result = await finalizeFactoryJob(created);
    if (result.incompleteReview) return { job: { ...created, metrics: result.metrics }, autoCompleted: false, reviewRequired: true, incompleteReview: true };
    return { job: created, autoCompleted: true, result };
  }
  return { job: created, autoCompleted: false, reviewRequired: true };'''
manual='''  // Even a fully verified publisher workbook waits for an explicit admin
  // confirmation before creating a Passage or publishing a catalog.
  return { job: created, autoCompleted: false, reviewRequired: true };'''
if auto_start not in text: raise SystemExit('factory auto-complete block missing')
text=text.replace(auto_start,manual,1)
old='try { return await finalizeFactoryJob(job, body.sentenceRows, body.allowIncomplete === true); }'
new='try { return await finalizeFactoryJob(job, body.sentenceRows, body.allowIncomplete === true, false, true, body.finalize !== true); }'
if old not in text: raise SystemExit('factoryConfirm call missing')
text=text.replace(old,new,1)
path.write_text(text)

# 3) Admin UI: validation button, then an unambiguous final button.
path=Path('ready/admin/app.js')
text=path.read_text()
start=text.index('function renderFactoryReview(result){')
end=text.index('function captureFactoryRows(){',start)
render=r'''function renderFactoryReview(result){const root=$('#factory-review');if(!root)return;const job=result?.job||state.factoryJob;if(!job)return;const changedJob=state.factoryJob?.id!==job.id;state.factoryJob=job;if(changedJob||!state.factoryRows.length)state.factoryRows=Array.isArray(job.extracted_rows)?job.extracted_rows.map(row=>({text:String(row.text||''),translation:String(row.translation||'')})):[];const extraction=job.extraction||{},existing=job.source_metadata?.factoryMode==='existing_passage';root.hidden=false;root.innerHTML=`<section class="card form-card"><p class="eyebrow">${existing?'CANONICAL CHECK':'SENTENCE REVIEW'}</p><h2>${existing?'기존 Passage 문장 확인':'문장쌍 확정'}</h2><p class="lead">${escapeHtml(extraction.reason||'영문/한글 문장쌍을 확인해 주세요.')} ${existing?'이 문장들은 수정되지 않습니다.':'현재 순서가 문장 번호입니다.'}</p><div class="table-wrap"><table><thead><tr><th>#</th><th>English</th><th>해석</th>${existing?'':'<th></th>'}</tr></thead><tbody>${state.factoryRows.map((row,index)=>`<tr><td>${index+1}</td><td><textarea data-factory-en="${index}" rows="3" ${existing?'readonly':''}>${escapeHtml(row.text)}</textarea></td><td><textarea data-factory-ko="${index}" rows="3" ${existing?'readonly':''}>${escapeHtml(row.translation)}</textarea></td>${existing?'':`<td><button class="button danger small" type="button" data-factory-delete="${index}">삭제</button><button class="button quiet small" type="button" data-factory-add-after="${index}">+ 아래</button></td>`}</tr>`).join('')}</tbody></table></div>${existing?'':'<button class="button quiet" type="button" data-factory-add-after="'+(state.factoryRows.length-1)+'">+ 문장 추가</button>'}<button class="button primary" type="button" data-factory-confirm>${existing?'워크북 검증':'문장 확인 및 워크북 검증'}</button></section>`;}
'''
text=text[:start]+render+text[end:]
start=text.index('async function confirmFactory(')
end=text.index('async function regenerateFactoryWorkbook',start)
confirm=r'''async function confirmFactory({finalize=false,allowIncomplete=false}={}){if(!state.factoryJob)return;const existing=state.factoryJob.source_metadata?.factoryMode==='existing_passage';if(!finalize)captureFactoryRows();const payload={jobId:state.factoryJob.id,finalize,allowIncomplete,...(!finalize&&!existing?{sentenceRows:state.factoryRows}:{})};const result=await safely(()=>call('factory_confirm',payload,state.token,finalize?'Passage와 워크북을 최종 저장하는 중…':'워크북을 생성하고 검증하는 중…'));if(!result)return;if(!finalize&&result.confirmationRequired){const incomplete=result.incompleteReview===true;$('#factory-review').innerHTML=`<section class="card form-card"><div class="result ${incomplete?'bad':'good'}"><strong>${incomplete?'단계별 문제 수를 확인해 주세요.':'검증 완료'}</strong><p>${escapeHtml(factoryCoverage(result.metrics))}</p><p>${incomplete?'누락된 exercise는 학생에게 공개되지 않습니다. 아래 버튼을 누르면 이 상태를 인정하고 Passage와 워크북을 저장합니다.':'모든 필수 단계가 검증되었습니다. 아래 버튼을 눌러야 Passage와 워크북이 실제로 저장됩니다.'}</p></div><button class="button ${incomplete?'danger':'primary'}" type="button" ${incomplete?'data-factory-finalize-incomplete':'data-factory-finalize'}>${incomplete?'누락을 인정하고 최종 확정':'최종 확정'}</button></section>`;return;}state.factoryJob={...state.factoryJob,status:'ready'};$('#factory-review').innerHTML=`<div class="card result good"><strong>Workbook ready</strong><p>${escapeHtml(factoryCoverage(result.metrics))}</p><p>문장 ${result.metrics?.sentenceCount||0} · deterministic ${result.metrics?.deterministicGeneratedExercises||0} · Gemini ${result.metrics?.geminiGeneratedExercises||0} · validator DROP ${result.metrics?.validatorDrop||0}</p></div>`;await loadAdmin();toast(existing?'기존 Passage는 그대로 두고 워크북만 저장했습니다.':'최종 확정되어 Passage와 READY 워크북을 저장했습니다.');}
'''
text=text[:start]+confirm+text[end:]
old="if(button?.hasAttribute('data-factory-confirm-incomplete'))return confirmFactory(true);if(button?.hasAttribute('data-factory-confirm'))return confirmFactory();"
new="if(button?.hasAttribute('data-factory-finalize-incomplete'))return confirmFactory({finalize:true,allowIncomplete:true});if(button?.hasAttribute('data-factory-finalize'))return confirmFactory({finalize:true});if(button?.hasAttribute('data-factory-confirm'))return confirmFactory();"
if old not in text: raise SystemExit('factory click handlers missing')
text=text.replace(old,new,1)
path.write_text(text)

# 4) Regressions.
path=Path('tests/verify-ready-workbook-factory.mjs')
text=path.read_text()
marker="assert.equal(new Set(parsedCatalog.stages.find(stage=>stage.stage===7).items.map(item=>item.key)).size,2,'Context 1 and grammar 1 must not collide.');\n"
if marker not in text: raise SystemExit('factory test marker missing')
addition=r'''

// Donga-style Stage 5 uses (Let) us in the exercise while canonical English
// uses the contraction “Let’s”.
const letWorkbook=`[PAGE 1]\n워크북 2 빈칸 연습 (한글)\n1. Let’s find out whether you fall into any of the following categories.1)\n해당하는 범주를 알아보자.\n[PAGE 2]\n워크북 3 빈칸 연습 (영문)\n1. 해당하는 범주를 알아보자.1)\nLet’s ____________.\n[PAGE 3]\n워크북 5 동사형 연습\n1. 해당하는 범주를 알아보자.1)\n(Let) us (find) out whether you (fall) into any of the (follow) categories.\n[PAGE 4]\nAnswer Key\n워크북 5 동사형 연습\n1) Let / find / fall / following`;
const letAudit=inspectFullWorkbookText(letWorkbook);
assert.equal(letAudit.exercises.filter(item=>item.type==='verb_form'&&item.provenance?.origin==='publisher_answer_key').length,1,'Stage 5 must accept publisher Let us against canonical Let’s.');

// Answer-key column extraction can place a Stage 7 continuation item before
// the repeated Stage 7 heading.
const orphanStage7=`[PAGE 1]\n워크북 2 빈칸 연습 (한글)\n1. Alpha beta gamma.1)\n알파 베타 감마.\n[PAGE 2]\n워크북 3 빈칸 연습 (영문)\n1. 알파 베타 감마.1)\nAlpha beta gamma.\n[PAGE 3]\n워크북 7 어색한 곳 찾기 연습\n어법상 어색한 것 찾기\n5 다음 글의 밑줄 친 부분 중 어법상 어색한 것을 두 개 찾아 바르게 고쳐 쓰시오.5)\nWrongA WrongB gamma.\n(1) __________________ → __________________\n(2) __________________ → __________________\n[PAGE 4]\nAnswer Key\n5) (1) WrongA → Alpha\n(2) WrongB → beta\n워크북 7 어색한 곳 찾기 연습\n어법상 어색한 것 찾기\n워크북 8 순서배열 연습`;
const orphanAudit=inspectFullWorkbookText(orphanStage7);
assert.equal(orphanAudit.exercises.filter(item=>item.type==='error_correction'&&item.sourceNumber===5).length,1,'Stage 7 must recover an answer-key continuation emitted before its repeated heading.');

const adminFactorySource=readFileSync(resolve(root,'ready/admin/app.js'),'utf8');
const factoryServerSource=readFileSync(resolve(root,'server/ready/index.ts'),'utf8');
assert.match(adminFactorySource,/누락을 인정하고 최종 확정/,'Incomplete Factory preview must expose an explicit final confirmation.');
assert.match(adminFactorySource,/>최종 확정</,'Complete Factory preview must expose an explicit final confirmation.');
assert.match(factoryServerSource,/body\.finalize !== true/,'Factory confirm must preview unless the admin explicitly finalizes.');
assert.doesNotMatch(factoryServerSource,/autoCompleted: true/,'Full workbooks must never auto-create a Passage.');
'''
text=text.replace(marker,marker+addition,1)
path.write_text(text)
