import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {extractUnicodePdfText} from '../../server/ready/pdf-text-extract.mjs';

export const fixtureRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../fixtures/pdf');
export const contracts=JSON.parse(readFileSync(resolve(fixtureRoot,'contracts.json'),'utf8'));
export const semanticText=value=>String(value??'').normalize('NFKC').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const rowMeaning=rows=>rows.map(r=>[semanticText(r.text),semanticText(r.translation)]);
export const rowDigest=rows=>sha256(JSON.stringify(rowMeaning(rows)));
export const stageCounts=catalog=>Object.fromEntries(catalog.stages.map(s=>[s.semanticType,s.items.length]));
export const exerciseCounts=exercises=>exercises.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{});
export const itemMeaning=item=>({number:item.number,kind:item.kind,prompt:semanticText(item.prompt),answers:item.answers.map(semanticText),...(item.hints?{hints:item.hints.map(semanticText)}:{}),...(item.groups?{groups:item.groups.map(g=>g.map(semanticText))}:{}),...(item.canonicalStart===undefined?{}:{canonicalStart:item.canonicalStart,canonicalEnd:item.canonicalEnd})});
export function selectedDrafts(drafts,contract) {
  if(!contract.scope)return drafts;
  const {from,to}=contract.scope;
  return drafts.filter(d=>/^\d+$/.test(d.number)&&Number(d.number)>=from&&Number(d.number)<=to);
}
export async function loadPdfFixture(contract) {
  const path=resolve(process.env.READY_PDF_FIXTURE_DIR||fixtureRoot,contract.file);
  let bytes;
  try {bytes=readFileSync(path);} catch(error) {throw new Error(`Missing licensed PDF fixture: ${path}. See tests/fixtures/pdf/README.md. Full PDF regression does not silently skip missing files.`,{cause:error});}
  if(sha256(bytes)!==contract.sha256)throw new Error(`${contract.id}: original PDF SHA-256 mismatch`);
  const text=await extractUnicodePdfText(bytes.toString('base64'));
  return {bytes,text,metadata:{title:contract.title,documentName:contract.documentName,documentSha256:contract.sha256}};
}

// Artifact projection intentionally excludes UUIDs, revision/timing metadata,
// progress history and salted verifier hashes. Token banks retain multiplicity;
// display shuffle order is not a learning contract.
export function canonicalArtifact(rows) {
  return rows.map(r=>({blockType:r.blockType||r.block_type||'SENTENCE',paragraphIndex:r.paragraphIndex||0,text:semanticText(r.text),translation:semanticText(r.translation)}));
}
export function catalogArtifact(catalog,{student=false,sourceCatalog=null}={}) {
  return catalog.stages.map(stage=>({stage:stage.stage,semanticType:stage.semanticType||sourceCatalog?.stages.find(s=>s.stage===stage.stage)?.semanticType||null,itemCount:stage.items.length,items:stage.items.map(item=>{
    const originItem=sourceCatalog?.stages.find(s=>s.stage===stage.stage)?.items.find(i=>i.key===item.key)||item;
    const answers=student?item.grading?.answers:item.answers;
    return {
      number:originItem.number,kind:item.kind,semanticType:item.semanticType,
      origin:originItem.provenance?.origin||null,
      source:semanticText(item.source),prompt:semanticText(item.prompt),
      ...(answers?{answers:answers.map(semanticText)}:{}),
      ...(item.hints?{hints:item.hints.map(semanticText)}:{}),
      ...(item.groups?{groups:item.groups.map(g=>g.map(semanticText).sort())}:{}),
      ...(student?{slotCount:item.slotCount,gradingMode:item.grading?.mode||null,assistance:item.assistance?{mode:item.assistance.mode,recallMode:item.assistance.recallMode||null,slots:item.assistance.slots.map(s=>s.normalizedLength===undefined?{}:{normalizedLength:s.normalizedLength})}:null}:{})
    };
  })}));
}
export async function expectPdfArtifact(contract,kind,actual) {
  const {mkdirSync,writeFileSync}=await import('node:fs');
  const {default:assert}=await import('node:assert/strict');
  const path=resolve(process.env.READY_PDF_FIXTURE_DIR||fixtureRoot,'expected',`${contract.id}.${kind}.json`);
  // Deliberate authoring command only; the normal test path never blesses output.
  if(process.env.READY_RECORD_PDF_EXPECTATIONS==='1') {
    mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(actual,null,2)+'\n');
    console.log(`RECORDED ${contract.id}.${kind}; expectedDigests.${kind}=${sha256(JSON.stringify(actual))} (review the semantic diff before accepting)`);
    return;
  }
  const expected=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(sha256(JSON.stringify(expected)),contract.expectedDigests[kind],`${contract.id}: private expected artifact must match the versioned semantic digest`);
  assert.deepEqual(actual,expected,`${contract.id}: ${kind} canonical / generated catalog / Student contract changed`);
}
