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

# The final-confirmation label lives inside a ternary template expression, so
# assert the literal label rather than requiring it to be static HTML.
path = Path('tests/verify-ready-workbook-factory.mjs')
text = path.read_text()
old = "assert.match(adminSource,/>최종 확정</,'Complete Factory preview must expose an explicit final confirmation.');"
new = "assert.match(adminSource,/'최종 확정'/,'Complete Factory preview must expose an explicit final confirmation.');"
if old not in text:
    raise SystemExit('final confirmation assertion marker missing')
text = text.replace(old, new, 1)
path.write_text(text)
