from pathlib import Path

path = Path('server/ready/workbook-factory.mjs')
text = path.read_text()
old = "  const raw = String(value ?? ''), nextStage = raw.search(/워크북\\s*8(?:\\D|$)/), scoped = nextStage >= 0 ? raw.slice(0, nextStage) : raw;\n  return [...scoped.matchAll(/\\((\\d+)\\)\\s*([\\s\\S]*?)\\s*(?:→|->|⇒)\\s*([\\s\\S]*?)(?=\\(\\d+\\)\\s*|$)/g)]"
new = "  const raw = String(value ?? ''), nextStage = raw.search(/워크북\\s*8(?:\\D|$)/), bounded = nextStage >= 0 ? raw.slice(0, nextStage) : raw, scoped = bounded.replace(/\\[PAGE\\s+\\d+\\][\\s\\S]*?(?=\\(\\d+\\)\\s*)/gi, ' ');\n  return [...scoped.matchAll(/\\((\\d+)\\)\\s*([\\s\\S]*?)\\s*(?:→|->|⇒)\\s*([\\s\\S]*?)(?=\\(\\d+\\)\\s*|$)/g)]"
if old not in text:
    raise SystemExit('Stage 7 page-break parser marker missing')
text = text.replace(old, new, 1)
path.write_text(text)
