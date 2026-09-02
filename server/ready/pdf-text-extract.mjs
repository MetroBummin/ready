// Minimal text-layer extractor for text PDFs.  Unlike a raw PDF string scan,
// this follows each embedded ToUnicode CMap before returning text, so CID font
// glyph bytes can never leak into the Admin sentence-review UI as mojibake.

const latin1 = bytes => new TextDecoder('iso-8859-1').decode(bytes);
const clean = value => String(value ?? '').replace(/\u0000|[\uD800-\uDFFF]/g, '').trim();
const utf16 = hex => { const bytes = new Uint8Array((hex.match(/.{1,2}/g) || []).map(value => Number.parseInt(value, 16))); return new TextDecoder('utf-16be').decode(bytes); };

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return latin1(new Uint8Array(await new Response(stream).arrayBuffer()));
}
function objects(binary, bytes) {
  const output = new Map();
  for (const match of binary.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
    const body = match[2], offset = match.index + match[0].indexOf(body), streamAt = body.indexOf('stream');
    let stream = null;
    if (streamAt >= 0) {
      let start = offset + streamAt + 6;
      if (binary[start] === '\r' && binary[start + 1] === '\n') start += 2; else if (binary[start] === '\n') start += 1;
      const end = binary.indexOf('endstream', start);
      if (end >= start) { let dataEnd = end; if (binary[dataEnd - 1] === '\n') dataEnd -= 1; if (binary[dataEnd - 1] === '\r') dataEnd -= 1; stream = bytes.slice(start, dataEnd); }
    }
    output.set(Number(match[1]), { body, stream });
  }
  return output;
}
function cmap(text) {
  const map = new Map();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const entry of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)/g)) map.set(Number.parseInt(entry[1], 16), utf16(entry[2]));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const entry of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)/g)) {
    const first = Number.parseInt(entry[1], 16), last = Number.parseInt(entry[2], 16), start = Number.parseInt(entry[3], 16);
    for (let code = first; code <= last; code += 1) map.set(code, String.fromCodePoint(start + code - first));
  }
  return map;
}
function decodeGlyphs(hex, map) {
  let output = '';
  for (let at = 0; at + 3 < hex.length; at += 4) output += map.get(Number.parseInt(hex.slice(at, at + 4), 16)) || '';
  return output;
}
function textChunks(content, fontMaps) {
  const fragments = [];
  for (const block of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
    let font = '', position = null;
    const token = /\/(F\d+)\s+[\d.]+\s+Tf|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm|\[([\s\S]*?)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g;
    for (const match of block[1].matchAll(token)) {
      if (match[1]) { font = match[1]; continue; }
      if (match[2]) { position = { x: Number(match[2]), y: Number(match[3]) }; continue; }
      if (!position || !fontMaps.get(font)) continue;
      const hexes = match[4] ? [...match[4].matchAll(/<([0-9a-fA-F]+)>/g)].map(entry => entry[1]) : [match[5]];
      const value = clean(hexes.map(hex => decodeGlyphs(hex, fontMaps.get(font))).join(''));
      if (value) fragments.push({ ...position, value });
    }
  }
  const lines = [];
  // The page transform used by Hancom PDFs makes smaller text-matrix Y values
  // appear higher on the page, so preserve that visual reading order here.
  for (const fragment of fragments.sort((left, right) => left.y - right.y || left.x - right.x)) {
    const line = lines.find(candidate => Math.abs(candidate.y - fragment.y) < 1.5);
    if (line) line.fragments.push(fragment); else lines.push({ y: fragment.y, fragments: [fragment] });
  }
  // This publisher layout places the English source and Korean translation in
  // separate columns. Keep the columns separate before sentence parsing: a
  // visual row can contain a wrapped English fragment and a different Korean
  // fragment, which must never be paired merely because their Y values match.
  const left = [], right = [];
  for (const line of lines) {
    const fragments = line.fragments.sort((first, second) => first.x - second.x);
    const target = fragments.filter(fragment => fragment.x < 3_100);
    const other = fragments.filter(fragment => fragment.x >= 3_100);
    if (target.length) left.push(clean(target.map(fragment => fragment.value).join(' ')));
    if (other.length) right.push(clean(other.map(fragment => fragment.value).join(' ')));
  }
  return [...left, ...right];
}

export async function extractUnicodePdfText(base64) {
  const encoded = clean(base64).replace(/^data:application\/pdf;base64,/i, '');
  if (!encoded) throw new Error('PDF data is missing.');
  let binary; try { binary = atob(encoded); } catch { throw new Error('PDF data is invalid.'); }
  const bytes = Uint8Array.from(binary, value => value.charCodeAt(0)), source = latin1(bytes), objectMap = objects(source, bytes), fontMaps = new Map();
  for (const [id, object] of objectMap) {
    const unicode = object.body.match(/\/ToUnicode\s+(\d+)\s+0\s+R/); if (!unicode) continue;
    const cmapObject = objectMap.get(Number(unicode[1])); if (!cmapObject?.stream) continue;
    try { const map = cmap(cmapObject.body.includes('/FlateDecode') ? await inflate(cmapObject.stream) : latin1(cmapObject.stream)); const name = object.body.match(/\/Name\s+\/(F\d+)/)?.[1]; if (name && map.size) fontMaps.set(name, map); }
    catch { /* A malformed optional CMap cannot be trusted as text. */ }
  }
  const chunks = [];
  for (const object of objectMap.values()) if (object.stream && /\/FlateDecode/.test(object.body) && !/\/ToUnicode/.test(object.body)) {
    try { chunks.push(...textChunks(await inflate(object.stream), fontMaps)); } catch { /* image/font stream */ }
  }
  const text = chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text || (text.match(/[A-Za-z가-힣]/g) || []).length < 40) throw new Error('The PDF text layer is not Unicode-readable.');
  return text;
}
