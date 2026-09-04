#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';

function arg(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:'';}
const catalogsPath=arg('--catalogs'),sentencesPath=arg('--sentences'),outputPath=arg('--output');
if(!catalogsPath||!sentencesPath||!outputPath)throw new Error('Usage: ready-create-workbook-golden --catalogs catalogs.json --sentences sentences.json --output golden.json [--questions rows.json --exam-links rows.json --attempts rows.json]');

const catalogs=JSON.parse(await readFile(catalogsPath,'utf8'));
const sentences=JSON.parse(await readFile(sentencesPath,'utf8'));
const passageIds=new Set(catalogs.map(row=>row.passage_id));
const byPassage=new Map();
for(const row of sentences){if(!passageIds.has(row.passage_id))continue;if(!byPassage.has(row.passage_id))byPassage.set(row.passage_id,[]);byPassage.get(row.passage_id).push(row);}

function redactor(){
  const words=new Map();let next=1;
  function existingParts(key){
    const known=[...words.keys()].filter(candidate=>candidate.length>1||/^\d+$/u.test(candidate)).sort((a,b)=>b.length-a.length),memo=new Map();
    function visit(at){if(at===key.length)return [];if(memo.has(at))return memo.get(at);for(const candidate of known)if(key.startsWith(candidate,at)){const rest=visit(at+candidate.length);if(rest)return [candidate,...rest];}memo.set(at,null);return null;}
    const parts=visit(0);return parts&&parts.length>1?parts:null;
  }
  return value=>String(value??'')
    .replace(/\bLet['’]s\b/giu,'Let us').replace(/\bI['’]m\b/giu,'I am').replace(/\b(i|you|we|they)['’]ve\b/giu,'$1 have')
    .replace(/\b(you|we|they)['’]re\b/giu,'$1 are').replace(/\b(he|she|it|that)['’]s\b/giu,'$1 is')
    .replace(/\b(can|could|do|does|did|has|have|had|is|are|was|were|will|would|should|must)n['’]t\b/giu,'$1 not')
    .replace(/[⟦]?(?:CHOICE|ORDER):\d+[⟧]?|[\p{L}\p{N}]+/gu,token=>{
    if(/^(?:⟦)?(?:CHOICE|ORDER):\d+(?:⟧)?$/u.test(token))return token;
    const key=token.normalize('NFKC').toLowerCase();
    const parts=!words.has(key)&&existingParts(key);if(parts){const joined=parts.map(part=>words.get(part)).join('');return /^[A-Z]/u.test(token)?joined[0].toUpperCase()+joined.slice(1):joined;}
    if(!words.has(key))words.set(key,`${/[가-힣]/u.test(token)?'k':'t'}${String(next++).padStart(4,'0')}`);
    const replacement=words.get(key);return /^[A-Z]/u.test(token)?replacement[0].toUpperCase()+replacement.slice(1):replacement;
  });
}

function itemFixture(item,redact){
  const copy={key:item.key,number:item.number,stage:item.stage,kind:item.kind};
  for(const field of ['source','prompt'])if(item[field]!=null)copy[field]=redact(item[field]);
  for(const field of ['answers','publisherAnswers','hints','wordBank'])if(Array.isArray(item[field]))copy[field]=item[field].map(redact);
  if(Array.isArray(item.groups))copy.groups=item.groups.map(group=>group.map(redact));
  if(item.pairCount!=null)copy.pairCount=item.pairCount;
  if(item.subtype!=null)copy.subtype=item.subtype;
  return copy;
}

const goldenCatalogs=[],goldenSentences=[];
for(const row of catalogs){
  const redact=redactor(),canonical=(byPassage.get(row.passage_id)||[]).sort((a,b)=>Number(a.sentence_index)-Number(b.sentence_index));
  goldenSentences.push(...canonical.map(sentence=>({passage_id:row.passage_id,sentence_index:sentence.sentence_index,text:redact(sentence.text),translation:redact(sentence.translation)})));
  goldenCatalogs.push({passage_id:row.passage_id,workbook_key:row.workbook_key,catalog:{workbookKey:row.catalog?.workbookKey||row.workbook_key,stages:(row.catalog?.stages||[]).filter(stage=>Number(stage.stage)>=5&&Number(stage.stage)<=9).map(stage=>({stage:stage.stage,items:(stage.items||[]).map(item=>itemFixture(item,redact))}))}});
}

async function relation(path){
  if(!path)return {count:0,sha256:''};
  const rows=JSON.parse(await readFile(path,'utf8')),stable=JSON.stringify(rows);
  return {count:rows.length,sha256:createHash('sha256').update(stable).digest('hex')};
}

const fixture={version:'production_workbook_golden_v1',generatedFrom:{catalogs:goldenCatalogs.length,auditedCanonicalSentences:sentences.length,representedCanonicalSentences:goldenSentences.length},catalogs:goldenCatalogs,sentences:goldenSentences,relationships:{questions:await relation(arg('--questions')),examPassages:await relation(arg('--exam-links')),workbookAttempts:await relation(arg('--attempts'))}};
await writeFile(outputPath,JSON.stringify(fixture)+'\n');
console.log(JSON.stringify({output:outputPath,catalogs:goldenCatalogs.length,sentences:goldenSentences.length,relationships:fixture.relationships},null,2));
