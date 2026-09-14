import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractUnicodePdfText} from '../server/ready/pdf-text-extract.mjs';
import {preparePublisherImport} from '../server/ready/studio-import.mjs';
import {compileStudio} from '../server/ready/studio-authoring.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/publisher-import/september-2026-canonical.json',import.meta.url),'utf8'));
const expectedKorean={
  22:[
    ['끌어당김','끌어당긴다','긍정적','부정적','긍정적','부정적','결과','가져올','말한다'],
    ['흔한','오류','명백히 하','시각화하'],
    ['진동','매우','자기력'],
    ['강력한','끌어당기는 것'],
    ['놀라울 만큼','열정적인','관계','확언할','가치 있','사랑받을 만하','자격이 있','관계','어려울'],
    ['모순되','과 일치하'],
  ],
  23:[
    ['변이','종','결정적'],
    ['통찰','자연 선택','선행 조건'],
    ['재앙적','기온','거대한','완전히','사라질'],
    ['재앙','에','적응한'],
    ['관찰했','원리','에','적용된다'],
    ['본성','재난','닥쳤','멸종할'],
    ['다행히도','단일'],
    ['진화 가능성','보존한다'],
  ],
};
const results={};
for(const number of ['21','22','23']){
  const source=readFileSync(new URL(`./fixtures/publisher-import/september-${number}.pdf`,import.meta.url)).toString('base64');
  const text=await extractUnicodePdfText(source),canonical=fixture[number].rows;
  const prepared=preparePublisherImport(text,canonical,{documentName:`september-${number}.pdf`});
  assert.deepEqual(prepared.rows.map(row=>row.id),canonical.map(row=>row.id),`${number}: existing sentence IDs must be retained.`);
  const catalog=compileStudio({rows:prepared.rows,annotations:prepared.annotations,title:number,workbookKey:`september-${number}`,requireConfirmed:true,publisherRequirements:prepared.publisherRequirements});
  results[number]={prepared,catalog};
  const counts=Object.fromEntries(catalog.stages.map(stage=>[stage.semanticType,stage.items.length]));
  const expectedCount=number==='21'?{korean_blank:10,english_blank:10,translation:11,verb_form:11,grammar_choice:10,word_order:11,writing:11}:{korean_blank:canonical.length,english_blank:canonical.length,translation:canonical.length,verb_form:canonical.length,grammar_choice:canonical.length,word_order:canonical.length,writing:canonical.length};
  assert.deepEqual(counts,expectedCount,`${number}: no Authoring or AUTO stage may be reduced.`);
  if(expectedKorean[number]){
    const sourceItems=prepared.sourceExercises.filter(item=>item.type==='korean_blank');
    assert.equal(sourceItems.length,expectedKorean[number].length,`${number}: every publisher Korean problem must be extracted.`);
    const stage=catalog.stages.find(item=>item.semanticType==='korean_blank');
    for(let index=0;index<expectedKorean[number].length;index++){
      const sourceExerciseId=`workbook-2-${index+1}`;
      const answers=stage.items.filter(item=>item.provenance?.sourceExerciseId===sourceExerciseId).flatMap(item=>item.answers);
      assert.deepEqual(answers,expectedKorean[number][index],`${number}-${index+1}: every Korean blank and answer must match the publisher source and DB canonical.`);
    }
  }
}

const finalSource=results['21'].prepared.sourceExercises.find(item=>item.provenance?.sourceExerciseId==='workbook-2-10');
assert.deepEqual([finalSource.canonicalStart,finalSource.canonicalEnd],[10,11],'21-10 must map to the two existing consecutive canonical sentences.');

const omitted=structuredClone(results['23'].prepared.annotations),firstRow=results['23'].prepared.rows[0];
omitted[firstRow.id].steps.korean_blank.targets=omitted[firstRow.id].steps.korean_blank.targets.slice(1);
assert.throws(()=>compileStudio({rows:results['23'].prepared.rows,annotations:omitted,title:'23 omitted',workbookKey:'23-omitted',requireConfirmed:true,publisherRequirements:results['23'].prepared.publisherRequirements}),error=>error.details?.some(item=>item.message==='publisher_catalog_coverage'&&item.sourceExerciseId==='workbook-2-1'),'A source target omitted after annotation conversion must block publication.');

console.log('READY September publisher import regression passed: 21 multi-sentence mapping, 22/23 Korean completeness, and fail-closed omission.');
