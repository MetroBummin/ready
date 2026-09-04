#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {auditWorkbookCatalog,repairStageNineCatalog} from '../server/ready/workbook-catalog-qa.mjs';

function arg(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:'';}
const catalogsPath=arg('--catalogs'),sentencesPath=arg('--sentences'),outputPath=arg('--output'),repair=process.argv.includes('--repair');
if(!catalogsPath||!sentencesPath)throw new Error('Usage: ready-audit-workbook-catalogs --catalogs catalogs.json --sentences sentences.json [--repair --output repaired.json]');
const catalogs=JSON.parse(await readFile(catalogsPath,'utf8')),sentences=JSON.parse(await readFile(sentencesPath,'utf8'));
const byPassage=new Map();for(const row of sentences){if(!byPassage.has(row.passage_id))byPassage.set(row.passage_id,[]);byPassage.get(row.passage_id).push(row);}
const report=[],repaired=[];
for(const row of catalogs){
  const canonical=(byPassage.get(row.passage_id)||[]).sort((a,b)=>Number(a.sentence_index)-Number(b.sentence_index));
  const errors=auditWorkbookCatalog(row.catalog,canonical),result=repair?repairStageNineCatalog(row.catalog,canonical):null;
  report.push({passageId:row.passage_id,workbookKey:row.workbook_key,totalErrors:errors.length,errors,repairs:result?.repairs.length||0,unresolved:result?.unresolved||[]});
  if(result)repaired.push({...row,catalog:result.catalog,qa:{repairs:result.repairs,unresolved:result.unresolved}});
}
if(outputPath&&repair)await writeFile(outputPath,JSON.stringify(repaired,null,2)+'\n');
console.log(JSON.stringify({catalogs:report.length,withErrors:report.filter(item=>item.totalErrors).length,totalErrors:report.reduce((sum,item)=>sum+item.totalErrors,0),repairs:report.reduce((sum,item)=>sum+item.repairs,0),unresolved:report.reduce((sum,item)=>sum+item.unresolved.length,0),report},null,2));
