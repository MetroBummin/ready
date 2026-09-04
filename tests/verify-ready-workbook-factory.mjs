import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACTORY_STAGES, SEMANTIC_WORKBOOK_CONTRACT, generateWorkbookCatalog, inspectFullWorkbookText, readyStageForSemanticType, semanticWorkbookType } from '../server/ready/workbook-factory.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=name=>readFileSync(resolve(root,'tests/fixtures',name),'utf8');
assert.deepEqual(FACTORY_STAGES,[1,2,3,4,5,6,7]);
assert.equal(readyStageForSemanticType('paragraph_ordering'),0);
assert.equal(readyStageForSemanticType('error_correction'),0);
assert.equal(readyStageForSemanticType('writing'),7);
assert.equal(semanticWorkbookType('WORKBOOK 9 문단 배열하기'),'paragraph_ordering');
assert.equal(semanticWorkbookType('WORKBOOK 10 영작 연습하기'),'writing');

for(const name of ['workbook-factory-textbook.txt','workbook-factory-mock.txt']){
  const inspected=inspectFullWorkbookText(fixture(name));
  assert.equal(inspected.fullWorkbook,true,name);
  const catalog=generateWorkbookCatalog({title:name,workbookKey:name,rows:inspected.rows,sourceExercises:inspected.exercises,provenance:{documentName:name}});
  assert.equal(catalog.contractVersion,SEMANTIC_WORKBOOK_CONTRACT);
  assert.deepEqual(catalog.stages.map(stage=>stage.stage),[1,2,3,4,5,6,7]);
  assert.equal(catalog.metrics.geminiCallCount,0);
  assert.equal(catalog.metrics.geminiGeneratedExercises,0);
  assert.equal(catalog.stages.some(stage=>stage.items.some(item=>item.semanticType==='paragraph_ordering'||item.kind==='correction_pairs')),false);
  for(const item of catalog.stages.find(stage=>stage.stage===6).items)for(const group of item.groups)for(const chip of group)assert.equal(/\s/.test(chip),false,'Stage 6 uses one word per chip.');
  for(const item of catalog.stages.find(stage=>stage.stage===7).items){assert.equal(item.kind,'full_sentence_input');assert.equal(item.prompt,'');assert.equal(item.answers.length,1);assert.equal(item.wordBank,undefined);}
}

const rows=[{text:'Students learn from mistakes.',translation:'학생들은 실수에서 배운다.'}];
const absent=generateWorkbookCatalog({title:'Absent',workbookKey:'absent',rows,sourceExercises:[]});
assert.equal(absent.stages.reduce((sum,stage)=>sum+stage.items.length,0),0,'SOURCE ABSENT means ITEM ABSENT.');
const paragraph=generateWorkbookCatalog({title:'Paragraph',workbookKey:'paragraph',rows,sourceExercises:[{type:'paragraph_ordering',number:1,prompt:'(A)-(B)-(C)',answer:'(C)-(A)-(B)',provenance:{sourceWorkbookNumber:9}}]});
assert.equal(paragraph.stages.find(stage=>stage.stage===6).items.length,0,'Paragraph order must never contaminate Stage 6.');
console.log('READY semantic Workbook Factory verified.');
