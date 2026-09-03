from pathlib import Path

path = Path('server/ready/workbook-factory.mjs')
text = path.read_text()
needle = "    .replace(/\\[PAGE\\s+\\d+\\]/gi, ' ')\n"
insert = "    .replace(/워크북\\s*[2-9][^\\n]*/g, ' ')\n"
if needle not in text:
    raise SystemExit('Stage 7 answer cleanup marker missing')
if insert not in text:
    text = text.replace(needle, needle + insert, 1)
path.write_text(text)
