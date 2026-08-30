// READY imports Breeze's exact lexical primitives. Keep READY-only token
// serialization here; the lemma source itself lives in modules/lexical/core.js.
import "../../modules/lexical/core.js";

const { lemma } = globalThis.BreezeLexical;
if (!lemma) throw new Error("BreezeLexical core failed to load");

export { lemma };

export function tokenizeSentence(text){
  const out=[]; const pattern=/[A-Za-z]+(?:[’'][A-Za-z]+)*/g; let match;
  while((match=pattern.exec(String(text||''))))out.push({tokenIndex:out.length,surface:match[0],normalized:match[0].toLowerCase().replace(/’/g,"'"),lemma:lemma(match[0]),startOffset:match.index,endOffset:match.index+match[0].length});
  return out;
}
