from pathlib import Path
path=Path('server/ready/workbook-factory.mjs')
text=path.read_text()
old="""function stage7PairsFromBlock(value) {
  return [...String(value ?? '').matchAll(/\\((\\d+)\\)\\s*([\\s\\S]*?)\\s*(?:→|->|⇒)\\s*([\\s\\S]*?)(?=\\(\\d+\\)\\s*|$)/g)]
    .map(match => [stage7AnswerPart(match[2]), stage7AnswerPart(match[3])])
    .filter(pair => pair[0] && pair[1] && !sameOption(pair[0], pair[1]));
}
"""
new="""function stage7PairsFromBlock(value) {
  let block = String(value ?? '');
  const boundary = block.search(/\\n\\s*(?:워크북\\s*[2-9]\\b|(?:문맥상|어법상)\\s*어색한 것 찾기)/);
  if (boundary >= 0) block = block.slice(0, boundary);
  return [...block.matchAll(/\\((\\d+)\\)\\s*([\\s\\S]*?)\\s*(?:→|->|⇒)\\s*([\\s\\S]*?)(?=\\(\\d+\\)\\s*|$)/g)]
    .map(match => [stage7AnswerPart(match[2]), stage7AnswerPart(match[3])])
    .filter(pair => pair[0] && pair[1] && !sameOption(pair[0], pair[1]));
}
"""
if old not in text: raise SystemExit('stage7PairsFromBlock generated block missing')
path.write_text(text.replace(old,new,1))
