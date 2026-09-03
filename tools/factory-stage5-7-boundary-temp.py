from pathlib import Path

path = Path('server/ready/workbook-factory.mjs')
text = path.read_text()

# Keep the final Stage 7 correction from swallowing the following Stage 8 key.
start = text.index('function stage7PairsFromBlock(value) {')
end = text.index('function stage7AnswerItems(text) {', start)
text = text[:start] + r'''function stage7PairsFromBlock(value) {
  const raw = String(value ?? ''), nextStage = raw.search(/워크북\s*8(?:\D|$)/), scoped = nextStage >= 0 ? raw.slice(0, nextStage) : raw;
  return [...scoped.matchAll(/\((\d+)\)\s*([\s\S]*?)\s*(?:→|->|⇒)\s*([\s\S]*?)(?=\(\d+\)\s*|$)/g)]
    .map(match => [stage7AnswerPart(match[2]), stage7AnswerPart(match[3])])
    .filter(pair => pair[0] && pair[1] && !sameOption(pair[0], pair[1]));
}
''' + text[end:]

# Track publisher Stage 7 sections. A new context #1 after a grammar family is
# a new passage section (e.g. main text -> supplementary text in one PDF).
start = text.index('function stage7PromptItems(text) {')
end = text.index('function stage7AnswerPart(value) {', start)
text = text[:start] + r'''function stage7PromptItems(text) {
  const value = workbookStagePages(text, 7).join('\n'), starts = [...value.matchAll(/(?:^|\n)\s*(\d+)\s+다음 글의 밑줄 친 부분 중\s*(문맥상|어법상)\s*어색한 것을\s*(?:두|세|네|\d+)\s*개 찾아 바르게 고쳐 쓰시오\.\s*(?:\d+\))?\s*/g)], output = [];
  let section = 0;
  for (let index = 0; index < starts.length; index += 1) {
    const number = Number(starts[index][1]), family = starts[index][2] === '문맥상' ? 'context' : 'grammar';
    if (family === 'context' && number === 1 && output.some(item => item.section === section && item.family === 'grammar')) section += 1;
    const from = starts[index].index + starts[index][0].length, to = index + 1 < starts.length ? starts[index + 1].index : value.length, block = value.slice(from, to), blank = block.search(/\(1\)\s*_{5,}/), prompt = clean((blank >= 0 ? block.slice(0, blank) : block).replace(/\[PAGE\s+\d+\][\s\S]*$/i, '')).replace(/\s+/g, ' ');
    if (prompt && isEnglish(prompt)) output.push({ family, number, prompt, section });
  }
  return output;
}
''' + text[end:]

# Resolve the selected publisher section from canonical round trips, but retain
# unresolved prompts from that same section so coverage cannot lie as 6/6 when
# the source actually contains 10 prompts.
start = text.index('function publisherStage7Exercises(text, rows) {')
end = text.index('\n// A full publisher workbook remains review_required', start)
text = text[:start] + r'''function publisherStage7Exercises(text, rows) {
  const prompts = stage7PromptItems(text), answers = stage7AnswerItems(text), resolved = new Map(), selectedSections = new Set();
  for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
    const promptItem = prompts[promptIndex], matches = [];
    for (const answerItem of answers.filter(item => item.number === promptItem.number && (!item.family || item.family === promptItem.family))) {
      const flat = answerItem.pairs.flat(), restored = correctionRoundTrip(promptItem.prompt, flat, rows);
      if (restored) matches.push({ answerItem, restored });
    }
    const signatures = new Map(matches.map(match => [`${match.restored.span.start}:${match.restored.span.end}:${JSON.stringify(match.answerItem.pairs)}`, match]));
    if (signatures.size !== 1) continue;
    resolved.set(promptIndex, signatures.values().next().value);
    selectedSections.add(promptItem.section);
  }
  const exercises = [];
  for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
    const promptItem = prompts[promptIndex];
    if (!selectedSections.has(promptItem.section)) continue;
    const sourceNumber = promptItem.number, number = exercises.length + 1, match = resolved.get(promptIndex);
    if (!match) {
      exercises.push({ type: 'error_correction', number, sourceNumber, subtype: promptItem.family, prompt: promptItem.prompt, answers: [], answer: '', canonicalStart: null, canonicalEnd: null, page: null, label: '워크북 7 어색한 곳 찾기 연습', provenance: { origin: 'publisher_prompt' } });
      continue;
    }
    const flat = match.answerItem.pairs.flat();
    exercises.push({ type: 'error_correction', number, sourceNumber, subtype: promptItem.family, prompt: promptItem.prompt, answers: flat, answer: match.answerItem.pairs.map(pair => `${pair[0]} → ${pair[1]}`).join(' / '), canonicalStart: match.restored.span.start, canonicalEnd: match.restored.span.end, page: null, label: '워크북 7 어색한 곳 찾기 연습', provenance: { origin: 'publisher_answer_key' } });
  }
  return exercises;
}
''' + text[end:]

old = "const publisherStage = stage => (Array.isArray(sourceExercises) ? sourceExercises : []).some(source => sourceStage(source?.type) === stage && clean(source?.prompt) && (clean(source?.answer) || (Array.isArray(source?.answers) && source.answers.length)));"
new = "const publisherStage = stage => (Array.isArray(sourceExercises) ? sourceExercises : []).some(source => sourceStage(source?.type) === stage && clean(source?.prompt) && (stage === 7 || clean(source?.answer) || (Array.isArray(source?.answers) && source.answers.length)));"
if old not in text:
    raise SystemExit('publisherStage fallback marker missing')
text = text.replace(old, new, 1)

old = "const publisherCounts = Object.fromEntries([5, 6, 7].map(stage => [stage, sourceExercises.filter(source => sourceStage(source?.type) === stage && clean(source?.prompt) && (clean(source?.answer) || (Array.isArray(source?.answers) && source.answers.length))).length]));"
new = "const publisherCounts = Object.fromEntries([5, 6, 7].map(stage => [stage, sourceExercises.filter(source => sourceStage(source?.type) === stage && clean(source?.prompt) && (stage === 7 || clean(source?.answer) || (Array.isArray(source?.answers) && source.answers.length))).length]));"
if old not in text:
    raise SystemExit('publisherCounts marker missing')
text = text.replace(old, new, 1)
path.write_text(text)

# Align regression checks with the new two-step preview/finalize contract.
path = Path('tests/verify-ready-workbook-factory.mjs')
text = path.read_text()
replacements = [
    (
        "assert.match(adminFactorySource,/>최종 확정</,'Complete Factory preview must expose an explicit final confirmation.');",
        "assert.match(adminFactorySource,/'최종 확정'/,'Complete Factory preview must expose an explicit final confirmation.');",
    ),
    (
        "assert.match(admin,/existing\\?\\{\\}:\\{sentenceRows:state\\.factoryRows\\}/,'Admin must not submit editable sentence rows in existing Passage mode.');",
        "assert.match(admin,/!finalize&&!existing\\?\\{sentenceRows:state\\.factoryRows\\}:\\{\\}/,'Admin must not submit editable sentence rows in existing Passage mode.');",
    ),
    (
        "assert.match(admin,/data-factory-confirm-incomplete[\\s\\S]*confirmFactory\\(true\\)/,'Admin must show coverage and require explicit confirmation before publishing an incomplete catalog.');",
        "assert.match(admin,/data-factory-finalize-incomplete[\\s\\S]*confirmFactory\\(\\{finalize:true,allowIncomplete:true\\}\\)/,'Admin must show coverage and require explicit confirmation before publishing an incomplete catalog.');",
    ),
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f'test patch marker missing: {old[:70]}')
    text = text.replace(old, new, 1)

coverage_marker = "assert.deepEqual(fullReuse.metrics.stageCoverage[7],{ready:1,expected:1},'Stage 7 expected count is source exercise count, never sentence count.');\n"
coverage_test = coverage_marker + "const incompletePublisherStage7=generateWorkbookCatalog({title:'Incomplete publisher Stage 7',workbookKey:'incomplete-publisher-stage7',rows:qualityRows,sourceExercises:[{type:'error_correction',number:1,sourceNumber:1,subtype:'grammar',prompt:stageSevenPrompt,answer:'has → have / explain → explains',provenance:{page:5}},{type:'error_correction',number:2,sourceNumber:2,subtype:'grammar',prompt:'Unresolved publisher prompt',answers:[],answer:'',provenance:{page:6}}]});\nassert.deepEqual(incompletePublisherStage7.metrics.stageCoverage[7],{ready:1,expected:2},'Stage 7 coverage must count unresolved publisher prompts so a partial parse cannot report a false complete total.');\n"
if coverage_marker not in text:
    raise SystemExit('coverage insertion marker missing')
text = text.replace(coverage_marker, coverage_test, 1)
path.write_text(text)

# The checked-in NE publisher PDF actually contains 4 context + 4 grammar
# Stage 7 prompts. The old four-item assertion covered only the context family.
path = Path('tests/verify-ready-pdf-text.mjs')
text = path.read_text()
text = text.replace(".length, 4, 'Stage 7 must preserve the publisher range exercise count rather than sentence count.');", ".length, 8, 'Stage 7 must preserve all publisher context and grammar range exercises rather than sentence count.');")
text = text.replace(".items.length, 4, 'Publisher Stage 7 must remain four passage/range exercises, not 41 sentence exercises.');", ".items.length, 8, 'Publisher Stage 7 must remain eight passage/range exercises, not 41 sentence exercises.');")
text = text.replace("assert.deepEqual(catalog.metrics.stageCoverage[7], { ready: 4, expected: 4 });", "assert.deepEqual(catalog.metrics.stageCoverage[7], { ready: 8, expected: 8 });")
path.write_text(text)
