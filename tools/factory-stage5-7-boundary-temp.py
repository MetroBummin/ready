from pathlib import Path

# Trim workbook headings that leak into an orphaned Stage 7 answer block.
path = Path('server/ready/workbook-factory.mjs')
text = path.read_text()
needle = "    .replace(/\\[PAGE\\s+\\d+\\]/gi, ' ')\n"
insert = "    .replace(/워크북\\s*[2-9][^\\n]*/g, ' ')\n"
if needle not in text:
    raise SystemExit('stage7AnswerPart page marker missing')
if insert not in text:
    text = text.replace(needle, needle + insert, 1)
path.write_text(text)

# Update regressions for the new two-step preview/finalize contract.
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
path.write_text(text)
