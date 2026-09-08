import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {contracts,fixtureRoot} from '../tests/helpers/ready-pdf-fixtures.mjs';
const directory=process.env.READY_PDF_FIXTURE_DIR||fixtureRoot;
const notes={
 'ybm-park-lesson4-text':['자동 추출은 단락/여백 문구 때문에 경계 검토 필요. 검토 fixture는 5쪽 전체를 본문 52 + Further Reading 12 문장쌍으로 보존.','publisher authored source 없음. 검토 후 PURE 3종은 모두 생성됨.'],
 'donga-lee-lesson4':['출판사 문장 번호 기준 41개 단위. 일부 단위에는 원문의 부제/여러 문장이 함께 있음.','출판사 영어 빈칸·동사형·어순·영작이 인쇄되어 있지만 현재 자동 정답 연결은 미해결. 어법 Factory 36개 중 Studio 단일문장 annotation 전환은 0개.'],
 'miraen-kim-lesson3':['자동 import는 여러 Workbook section 때문에 검토 필요. API fixture는 첫 본문 31개 단위를 검증.','Factory 동사형 31/어법 26개 중 Studio annotation으로 검증되는 동사형은 6개. 다른 source는 자동 생성으로 채우지 않음.'],
 'cheonjae-kang-lesson2':['자동 import는 여러 Workbook section 때문에 검토 필요. API fixture는 첫 본문 40개 단위를 검증.','Factory 어법 40개 중 Studio 단일문장 annotation은 33개. 영어 빈칸·동사형·어순·영작의 출판사 연결은 미해결.'],
 'mock-2026-june-grade2':['305쪽 전체를 파서에 입력: 26개 raw group. 19번/미분류 group/25·27·28번은 canonical 검토 필요로 차단.','원본 11MB는 API의 현재 7MB 제한으로 413. 원본 33–44, 282–283쪽을 그대로 복사한 21번 fixture로 실제 API→Student 8개 문장쌍 검증. 전체 모의고사 Student 등록을 뜻하지 않음.'],
 'mock-2026-september-grade2-text':['사용자의 최종 지정에 따라 21–40번 전체 포함. 18–28 제한을 적용하지 않음.','27·28번 안내문의 영/한 혼합행·제목은 기존 검토 단계의 수정 입력으로 보존. 다른 지문은 현재 importer의 문장쌍 단위를 유지.','publisher authored source 없음. 검토 후 20개 Passage / 158개 문장쌍의 PURE 3종 모두 생성됨.'],
};
let lines=['# PDF별 Workbook 회귀 fixture 요약','','이 표는 저장된 normalized expected artifact의 실제 API/Student 결과를 집계한다.','문장 수는 canonical 문장쌍 단위이며, 출판사가 함께 번역한 여러 문장/인용문은 한 단위일 수 있다.','생성 과정의 교사 검토·확정은 테스트가 수행한다. 운영 서비스에 자료를 등록한 결과가 아니다.','','| PDF | 실제 API Passage | canonical 문장쌍 | PURE 해석 / 어순 / 영작 | Student AUTHORED 한글 / 영어 / 동사형 / 어법 | 경고 항목 |','| --- | ---: | ---: | --- | --- | ---: |'];
const labels={'ybm-park-lesson4-text':'YBM 박준언 4과 본문','donga-lee-lesson4':'동아 이병민 4과 full','miraen-kim-lesson3':'미래엔 김성연 3과 full','cheonjae-kang-lesson2':'천재 강상구 2과 full','mock-2026-june-grade2':'2026 고2 6월 full / API 21번','mock-2026-september-grade2-text':'2026 고2 9월 21–40 본문'};
const warningCounts={'ybm-park-lesson4-text':1,'donga-lee-lesson4':2,'miraen-kim-lesson3':2,'cheonjae-kang-lesson2':2,'mock-2026-june-grade2':2,'mock-2026-september-grade2-text':1};
const detail=[];let total=0;
for(const c of contracts.documents){
 const student=JSON.parse(readFileSync(resolve(directory,'expected',c.id+'.student.json'),'utf8'));
 const counts={},candidates={};let sentences=0;
 for(const p of student.passages){sentences+=p.canonical.filter(r=>r.blockType==='SENTENCE').length;for(const s of p.studentCatalog)counts[s.semanticType]=(counts[s.semanticType]||0)+s.itemCount;for(const [s,n]of Object.entries(p.publisherCandidateCounts))candidates[s]=(candidates[s]||0)+n;}
 const values=types=>types.map(t=>counts[t]||0).join(' / ');
 lines.push(`| ${labels[c.id]} | ${student.passages.length} | ${sentences} | ${values(['translation','word_order','writing'])} | ${values(['korean_blank','english_blank','verb_form','grammar_choice'])} | ${warningCounts[c.id]} |`);
 total+=sentences;
 const rawCounts={};for(const d of c.drafts)for(const [s,n]of Object.entries(d.publisherStages||{}))rawCounts[s]=(rawCounts[s]||0)+n;
 detail.push('',`## ${c.documentName}`,'',`- 원본: ${c.pages}쪽 · SHA-256 \`${c.sha256}\``,`- source provenance: ${c.kind==='text'?'publisher 없음 / PURE = canonical_passage':'Factory = publisher_answer_key / Student = confirmed_annotation(출판사 후보를 교사 확정) + canonical_passage(PURE)'}`,`- Factory에서 검증된 publisher 문항: 한글 ${rawCounts.korean_blank||0} / 영어 ${rawCounts.english_blank||0} / 동사형 ${rawCounts.verb_form||0} / 어법 ${rawCounts.grammar_choice||0} / 어순 ${rawCounts.word_order||0} / 영작 ${rawCounts.writing||0}`,`- Factory unresolved: ${c.drafts.reduce((n,d)=>n+(d.unresolved||0),0)} (canonical 자체가 차단된 group은 별도)`,`- [canonical + Factory/PURE artifact](expected/${c.id}.factory.json)`,`- [실제 Studio + Student catalog artifact](expected/${c.id}.student.json)`,'',...notes[c.id].map(n=>'- '+n));
}
lines.push('',`실제 API 검증 합계: **26 Passage / ${total} canonical 문장쌍**. PDF의 모든 인쇄 Workbook 단계가 자동 지원된다는 의미는 아니다.`,'','경고는 경계 검토 또는 자동 source 연결의 제약 종류를 센 값이며, 원시 unresolved 문항 수와 다르다. 본문형 PDF의 publisher source 없음 자체는 오류가 아니다.','0개는 text-only에서의 **source 없음**과 full-PDF에서의 **source는 있으나 미해결**을 구분해서 읽어야 한다.',...detail,'','## 실행 / 보관','','- 전체: `npm run ready:test:full` (공개 기본 회귀 + 비공개 PDF 회귀)','- PDF만: `npm run ready:test:pdf`','- 공개 CI: `npm run ready:test` — 원본 PDF gate를 포함하지 않음','- fixture의 원본·검토 입력·normalized 전체 결과는 로컬 비공개 보관. 경로를 바꿀 때 `READY_PDF_FIXTURE_DIR` 지정.','- B audit/최적화는 사용자의 요청에 따라 진행하지 않음.','');
writeFileSync(resolve(fixtureRoot,'SUMMARY.md'),lines.join('\n'));
console.log('Wrote tests/fixtures/pdf/SUMMARY.md');
