import {readFileSync} from 'node:fs';

const golden=JSON.parse(readFileSync(new URL('../tests/fixtures/workbook-production-golden.json',import.meta.url),'utf8'));
const sources=JSON.parse(readFileSync(new URL('../tests/fixtures/workbook-semantic-source-audit.json',import.meta.url),'utf8'));
const sourceByKey=new Map(sources.catalogs.map(row=>[row.workbookKey,row]));
const rows=golden.catalogs.map(row=>{
  const counts=Object.fromEntries(row.catalog.stages.map(stage=>[Number(stage.stage),(stage.items||[]).length]));
  return {workbookKey:row.workbook_key,sourceStatus:sourceByKey.get(row.workbook_key)?.sourceStatus||'unregistered',oldItems:Object.values(counts).reduce((sum,count)=>sum+count,0),legacyCorrections:counts[7]||0,newStageCounts:null,unresolved:'source'};
});
const ready=rows.length===13&&rows.every(row=>row.sourceStatus==='verified'&&row.newStageCounts&&row.unresolved===0);
console.table(rows);
console.log(JSON.stringify({catalogCount:rows.length,publishReady:ready,requiredUnresolved:0},null,2));
if(!ready) process.exitCode=2;
