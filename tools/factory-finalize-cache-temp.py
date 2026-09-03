from pathlib import Path

# Cache the validated AI supplement between preview and final confirmation so
# the second click saves exactly what was previewed instead of calling Gemini
# again. Also keep the UI fail-closed if finalization ever returns incomplete.
path = Path('server/ready/index.ts')
text = path.read_text()
old = '''  let ai: { stages: Record<number, any[]>; tokenUsage: number; callCount: number; errors: string[] } = { stages: { 5: [], 6: [], 7: [] }, tokenUsage: 0, callCount: 0, errors: [] };
  // Keep the Edge request bounded: one source-grounded AI pass is followed by
  // the validated deterministic fallback for any remaining Stage 6/7 gaps.
  for (let round = 0; useAiFallback && round < 1; round += 1) {'''
new = '''  const cachedPreview: any = !previewOnly && !replaceExistingCatalog && job.extraction?.previewAi && typeof job.extraction.previewAi === "object" ? job.extraction.previewAi : null;
  let ai: { stages: Record<number, any[]>; tokenUsage: number; callCount: number; errors: string[] } = cachedPreview
    ? { stages: { 5: Array.isArray(cachedPreview.stages?.[5]) ? cachedPreview.stages[5] : [], 6: Array.isArray(cachedPreview.stages?.[6]) ? cachedPreview.stages[6] : [], 7: Array.isArray(cachedPreview.stages?.[7]) ? cachedPreview.stages[7] : [] }, tokenUsage: Math.max(0, Math.round(Number(cachedPreview.tokenUsage)) || 0), callCount: Math.max(0, Math.round(Number(cachedPreview.callCount)) || 0), errors: Array.isArray(cachedPreview.errors) ? cachedPreview.errors.map(error => clean(error, 240)).filter(Boolean) : [] }
    : { stages: { 5: [], 6: [], 7: [] }, tokenUsage: 0, callCount: 0, errors: [] };
  // Keep the Edge request bounded: one source-grounded AI pass is followed by
  // the validated deterministic fallback for any remaining Stage 6/7 gaps.
  // Final confirmation reuses the already validated preview supplement.
  for (let round = 0; !cachedPreview && useAiFallback && round < 1; round += 1) {'''
if old not in text:
    raise SystemExit('AI preview cache insertion marker missing')
text = text.replace(old, new, 1)
old = '''  if (previewOnly) {
    if (!replaceExistingCatalog) {
      const reviewed = await db.from("ready_workbook_factory_jobs").update({ status: "review_required", extracted_rows: rowsForCatalog, metrics: previewCatalog.metrics, failure_reason: "" }).eq("id", job.id);
      if (reviewed.error) throw new ApiError(500, reviewed.error.message);
    }
    return { confirmationRequired: true, incompleteReview: previewCatalog.metrics.incompleteStages.length > 0, metrics: previewCatalog.metrics };
  }'''
new = '''  if (previewOnly) {
    if (!replaceExistingCatalog) {
      const previewExtraction = { ...(job.extraction || {}), previewAi: { stages: ai.stages, tokenUsage: ai.tokenUsage, callCount: ai.callCount, errors: ai.errors } };
      const reviewed = await db.from("ready_workbook_factory_jobs").update({ status: "review_required", extracted_rows: rowsForCatalog, extraction: previewExtraction, metrics: previewCatalog.metrics, failure_reason: "" }).eq("id", job.id);
      if (reviewed.error) throw new ApiError(500, reviewed.error.message);
    }
    return { confirmationRequired: true, incompleteReview: previewCatalog.metrics.incompleteStages.length > 0, metrics: previewCatalog.metrics };
  }'''
if old not in text:
    raise SystemExit('preview persistence marker missing')
text = text.replace(old, new, 1)
old = '''  const completed = await db.from("ready_workbook_factory_jobs").update({ status: "ready", passage_id: passageId, extracted_rows: rowsForCatalog, metrics: catalog.metrics, completed_at: new Date().toISOString(), failure_reason: "" }).eq("id", job.id);'''
new = '''  const completedExtraction = { ...(job.extraction || {}) }; delete completedExtraction.previewAi;
  const completed = await db.from("ready_workbook_factory_jobs").update({ status: "ready", passage_id: passageId, extracted_rows: rowsForCatalog, extraction: completedExtraction, metrics: catalog.metrics, completed_at: new Date().toISOString(), failure_reason: "" }).eq("id", job.id);'''
if old not in text:
    raise SystemExit('completed extraction marker missing')
text = text.replace(old, new, 1)
path.write_text(text)

path = Path('ready/admin/app.js')
text = path.read_text()
old = "if(!result)return;if(!finalize&&result.confirmationRequired){const incomplete=result.incompleteReview===true;"
new = "if(!result)return;if(finalize&&result.incompleteReview){$('#factory-review').innerHTML=`<section class=\"card form-card\"><div class=\"result bad\"><strong>최종 저장 전 검증 결과가 달라졌습니다.</strong><p>${escapeHtml(factoryCoverage(result.metrics))}</p><p>Passage와 워크북은 아직 저장되지 않았습니다. 누락을 인정하고 저장하려면 아래 버튼을 눌러 주세요.</p></div><button class=\"button danger\" type=\"button\" data-factory-finalize-incomplete>누락을 인정하고 최종 확정</button></section>`;return;}if(!finalize&&result.confirmationRequired){const incomplete=result.incompleteReview===true;"
if old not in text:
    raise SystemExit('admin finalize fail-closed marker missing')
text = text.replace(old, new, 1)
path.write_text(text)

path = Path('tests/verify-ready-workbook-factory.mjs')
text = path.read_text()
marker = "assert.match(factoryServerSource,/body\\.finalize !== true/,'Factory confirm must preview unless the admin explicitly finalizes.');\n"
addition = marker + "assert.match(factoryServerSource,/previewAi/,'Final confirmation must reuse the validated preview supplement instead of regenerating it.');\nassert.match(adminFactorySource,/finalize&&result\\.incompleteReview/,'Finalization must remain fail-closed if the server reports a changed incomplete result.');\n"
if marker not in text:
    raise SystemExit('finalization regression marker missing')
text = text.replace(marker, addition, 1)
path.write_text(text)
