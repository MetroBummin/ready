import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACTORY_STAGES, SEMANTIC_WORKBOOK_CONTRACT, alignPublisherBlankPrompt, generateWorkbookCatalog, inspectFullWorkbookText, publisherGrammarCandidate, readyStageForSemanticType, semanticWorkbookType, validateSemanticWorkbookItem } from '../server/ready/workbook-factory.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=name=>readFileSync(resolve(root,'tests/fixtures',name),'utf8');
const legacyMockCompiler=readFileSync(resolve(root,'tools/ready-extract-mock-workbook-contract.py'),'utf8');
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

const numericSentence='In 2014, CO₂ cost 10,000 at 1.5 after a 15–20% rise.',numericRows=[{text:numericSentence,translation:'2014년에 CO₂의 가격은 10,000이었고 1.5에서 15–20% 상승했다.'}],numericTokens=['In','2014','CO₂','cost','10,000','at','1.5','after','a','15–20%','rise'];
const numericCatalog=generateWorkbookCatalog({title:'Numeric',workbookKey:'numeric',rows:numericRows,sourceExercises:[{type:'word_order',number:1,prompt:numericSentence,answer:numericSentence,canonicalText:numericSentence,canonicalStart:1,canonicalEnd:1,provenance:{sourceWorkbookNumber:6}}]});
const numericOrder=numericCatalog.stages.find(stage=>stage.stage===6).items[0];
assert.deepEqual([...numericOrder.groups[0]].sort(),[...numericTokens].sort(),'Publisher word-order chips must preserve every numeric expression without splitting it.');
assert.equal(numericOrder.answers[0],'in 2014 co₂ cost 10,000 at 1.5 after a 15–20% rise');
assert.equal(numericOrder.prompt,'⟦ORDER:0⟧','New word-order items must not append a detached period.');
assert.equal(validateSemanticWorkbookItem(6,numericOrder,new Map([[1,{...numericRows[0],index:1}]]),[{...numericRows[0],index:1}]),'','Stage 6 validation must accept source-faithful numeric chips.');
assert.match(legacyMockCompiler,/def order_tokens\(sentence: str\) -> list\[str\]:/,'The supported mock-workbook compiler must use its order-specific tokenizer.');
assert.doesNotMatch(legacyMockCompiler,/"prompt": "⟦ORDER:0⟧\."/,'The supported mock-workbook compiler must not create detached order-marker periods.');

const partialPublisher=publisherGrammarCandidate(5,[
  {number:1,prompt:'Alpha (work).'},
  {number:2,prompt:'Beta (run).'},
],[
  {number:1,answer:'works'},
  {number:2,answer:'runs / extra'},
],[
  {text:'Alpha works.',translation:'알파가 작동한다.'},
  {text:'Beta runs.',translation:'베타가 달린다.'},
]);
assert.equal(partialPublisher.length,1,'One malformed publisher row must not discard the other valid verb-form rows.');
assert.equal(partialPublisher[0].number,1);
assert.equal(alignPublisherBlankPrompt('The process is called ____________ ____________.',['natural selection'],'The process is called natural selection.'),'The process is called ______________.','Adjacent printed underlines may represent one multi-word answer.');
assert.equal(alignPublisherBlankPrompt('그것은 ____________의 ____________이다.',['진화','결과'],'그것은 진화의 결과이다.'),'그것은 ______________의 ______________이다.','Korean particles outside each underline must remain fixed.');
assert.equal(alignPublisherBlankPrompt('The process is called ____________ ____________.',['natural','selection'],'The process is called natural selection.'),'The process is called ______________ ______________.','Two answer slots may map to adjacent printed underlines when the source proves both slots.');
assert.equal(alignPublisherBlankPrompt('The process is called ____________.',['random drift'],'The process is called natural selection.'),'','A wrong answer must not round-trip merely because a blank exists.');
console.log('READY semantic Workbook Factory verified.');
