// Standards-based PDF text extraction shared by the Node verification suite
// and the Supabase Edge Function. PDF.js follows the document's own Unicode
// maps and content order; READY does not infer publisher columns from magic
// coordinates or inspect raw compressed PDF objects.

const clean = value => String(value ?? '').replace(/\u0000|[\uD800-\uDFFF]/g, '').replace(/\u00a0/g, ' ').trim();

function ensureTextExtractionGlobals() {
  // PDF.js initializes one identity matrix for its optional canvas renderer at
  // module load. Edge text extraction never renders a page, but Deno does not
  // expose DOMMatrix. Keep the compatibility surface deliberately minimal.
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = class TextExtractionDOMMatrix {
    constructor(values = [1, 0, 0, 1, 0, 0]) { [this.a, this.b, this.c, this.d, this.e, this.f] = values; }
  };
}

function decodeBase64(base64) {
  const encoded = clean(base64).replace(/^data:application\/pdf;base64,/i, '').replace(/\s+/g, '');
  if (!encoded) throw new Error('PDF data is missing.');
  try {
    const binary = atob(encoded);
    return Uint8Array.from(binary, value => value.charCodeAt(0));
  } catch {
    throw new Error('PDF data is invalid.');
  }
}

function pageText(items) {
  let output = '';
  for (const item of items) {
    const value = String(item?.str ?? '').replace(/\u0000|[\uD800-\uDFFF]/g, '').replace(/\u00a0/g, ' ');
    output += value;
    if (item?.hasEOL) output = `${output.replace(/[ \t]+$/g, '')}\n`;
  }
  return output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractUnicodePdfText(base64) {
  const data = decodeBase64(base64);
  ensureTextExtractionGlobals();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document;
  try {
    document = await getDocument({ data, disableWorker: true, useWorkerFetch: false }).promise;
  } catch {
    throw new Error('The PDF text layer could not be opened.');
  }
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      pages.push(`[PAGE ${pageNumber}]\n${pageText(content.items)}`);
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  const text = pages.join('\n\n').trim();
  if (!text || (text.match(/[A-Za-z가-힣]/g) || []).length < 40) throw new Error('The PDF text layer is not Unicode-readable.');
  return text;
}
