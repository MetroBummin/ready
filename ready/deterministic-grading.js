// Ordering answers come from source-faithful chips. Unlike generic text
// answers, their internal punctuation is semantic: 1.5 must not match 15,
// and 10,000 must not match 10000.
export function normalizeWorkbookOrderAnswer(value){
  return String(value??'').trim().normalize('NFC').toLowerCase()
    .replace(/[‐‑‒–—−]/g,'-')
    .replace(/\s+/g,' ').trim();
}
