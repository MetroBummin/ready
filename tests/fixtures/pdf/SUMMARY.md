# PDF별 Workbook 회귀 fixture 요약

이 표는 저장된 normalized expected artifact의 실제 API/Student 결과를 집계한다.
문장 수는 canonical 문장쌍 단위이며, 출판사가 함께 번역한 여러 문장/인용문은 한 단위일 수 있다.
생성 과정의 교사 검토·확정은 테스트가 수행한다. 운영 서비스에 자료를 등록한 결과가 아니다.

| PDF | 실제 API Passage | canonical 문장쌍 | PURE 해석 / 어순 / 영작 | Student AUTHORED 한글 / 영어 / 동사형 / 어법 | 경고 항목 |
| --- | ---: | ---: | --- | --- | ---: |
| YBM 박준언 4과 본문 | 2 | 64 | 64 / 64 / 64 | 0 / 0 / 0 / 0 | 1 |
| 동아 이병민 4과 full | 1 | 41 | 41 / 41 / 41 | 41 / 0 / 0 / 0 | 2 |
| 미래엔 김성연 3과 full | 1 | 31 | 31 / 31 / 31 | 0 / 0 / 6 / 0 | 2 |
| 천재 강상구 2과 full | 1 | 40 | 40 / 40 / 40 | 40 / 0 / 0 / 33 | 2 |
| 2026 고2 6월 full / API 21번 | 1 | 8 | 8 / 8 / 8 | 8 / 7 / 5 / 0 | 2 |
| 2026 고2 9월 21–40 본문 | 20 | 158 | 158 / 158 / 158 | 0 / 0 / 0 / 0 | 1 |

실제 API 검증 합계: **26 Passage / 342 canonical 문장쌍**. PDF의 모든 인쇄 Workbook 단계가 자동 지원된다는 의미는 아니다.

경고는 경계 검토 또는 자동 source 연결의 제약 종류를 센 값이며, 원시 unresolved 문항 수와 다르다. 본문형 PDF의 publisher source 없음 자체는 오류가 아니다.
0개는 text-only에서의 **source 없음**과 full-PDF에서의 **source는 있으나 미해결**을 구분해서 읽어야 한다.

## (2022개정)2026년_영어II_YBM(박준언)_4과_본문 (3).pdf

- 원본: 5쪽 · SHA-256 `56427eea3cbd2c8e0fbaa6bf17c62356a63876127fa39ffe95bb54684cf7aa05`
- source provenance: publisher 없음 / PURE = canonical_passage
- Factory에서 검증된 publisher 문항: 한글 0 / 영어 0 / 동사형 0 / 어법 0 / 어순 0 / 영작 0
- Factory unresolved: 0 (canonical 자체가 차단된 group은 별도)
- [canonical + Factory/PURE artifact](expected/ybm-park-lesson4-text.factory.json)
- [실제 Studio + Student catalog artifact](expected/ybm-park-lesson4-text.student.json)

- 자동 추출은 단락/여백 문구 때문에 경계 검토 필요. 검토 fixture는 5쪽 전체를 본문 52 + Further Reading 12 문장쌍으로 보존.
- publisher authored source 없음. 검토 후 PURE 3종은 모두 생성됨.

## (2022개정)2025년_공통영어2_동아(이병민)_4과_본문10단계 워크북 통합본(1~10) (1).pdf

- 원본: 50쪽 · SHA-256 `75c7d9118edd4fa0d891c33dd873283450c18c63765642a23fe96c3c13eb4ecf`
- source provenance: Factory = publisher_answer_key / Student = confirmed_annotation(출판사 후보를 교사 확정) + canonical_passage(PURE)
- Factory에서 검증된 publisher 문항: 한글 41 / 영어 0 / 동사형 0 / 어법 36 / 어순 0 / 영작 0
- Factory unresolved: 483 (canonical 자체가 차단된 group은 별도)
- [canonical + Factory/PURE artifact](expected/donga-lee-lesson4.factory.json)
- [실제 Studio + Student catalog artifact](expected/donga-lee-lesson4.student.json)

- 출판사 문장 번호 기준 41개 단위. 일부 단위에는 원문의 부제/여러 문장이 함께 있음.
- 출판사 영어 빈칸·동사형·어순·영작이 인쇄되어 있지만 현재 자동 정답 연결은 미해결. 어법 Factory 36개 중 Studio 단일문장 annotation 전환은 0개.

## (2022개정)2026년_영어II_미래엔(김성연)_3과_본문10단계 워크북 통합본(1~10).pdf

- 원본: 63쪽 · SHA-256 `68c677496e2e7388f803323413cb065875d4d13a9e99b4c418da8a7caaa222a3`
- source provenance: Factory = publisher_answer_key / Student = confirmed_annotation(출판사 후보를 교사 확정) + canonical_passage(PURE)
- Factory에서 검증된 publisher 문항: 한글 0 / 영어 0 / 동사형 31 / 어법 26 / 어순 0 / 영작 0
- Factory unresolved: 378 (canonical 자체가 차단된 group은 별도)
- [canonical + Factory/PURE artifact](expected/miraen-kim-lesson3.factory.json)
- [실제 Studio + Student catalog artifact](expected/miraen-kim-lesson3.student.json)

- 자동 import는 여러 Workbook section 때문에 검토 필요. API fixture는 첫 본문 31개 단위를 검증.
- Factory 동사형 31/어법 26개 중 Studio annotation으로 검증되는 동사형은 6개. 다른 source는 자동 생성으로 채우지 않음.

## (2022개정)2026년_영어II_천재(강상구)_2과_본문10단계 워크북 통합본(1~10).pdf

- 원본: 83쪽 · SHA-256 `3b8d75eaa374150e36335c3c9c579704768b306e188081c7cc61cb7f9809a2a2`
- source provenance: Factory = publisher_answer_key / Student = confirmed_annotation(출판사 후보를 교사 확정) + canonical_passage(PURE)
- Factory에서 검증된 publisher 문항: 한글 40 / 영어 0 / 동사형 0 / 어법 40 / 어순 0 / 영작 0
- Factory unresolved: 279 (canonical 자체가 차단된 group은 별도)
- [canonical + Factory/PURE artifact](expected/cheonjae-kang-lesson2.factory.json)
- [실제 Studio + Student catalog artifact](expected/cheonjae-kang-lesson2.student.json)

- 자동 import는 여러 Workbook section 때문에 검토 필요. API fixture는 첫 본문 40개 단위를 검증.
- Factory 어법 40개 중 Studio 단일문장 annotation은 33개. 영어 빈칸·동사형·어순·영작의 출판사 연결은 미해결.

## 2026년_고2_6월_부산광역시 교육청_학력평가_10단계_WORKBOOK_통합본(1~10).pdf

- 원본: 305쪽 · SHA-256 `756844d4748fa117eddb2384ca17ea8ee1172d1c06cc5d236b0cf03c3193a0eb`
- source provenance: Factory = publisher_answer_key / Student = confirmed_annotation(출판사 후보를 교사 확정) + canonical_passage(PURE)
- Factory에서 검증된 publisher 문항: 한글 161 / 영어 120 / 동사형 121 / 어법 113 / 어순 0 / 영작 0
- Factory unresolved: 1456 (canonical 자체가 차단된 group은 별도)
- [canonical + Factory/PURE artifact](expected/mock-2026-june-grade2.factory.json)
- [실제 Studio + Student catalog artifact](expected/mock-2026-june-grade2.student.json)

- 305쪽 전체를 파서에 입력: 26개 raw group. 19번/미분류 group/25·27·28번은 canonical 검토 필요로 차단.
- 원본 11MB는 API의 현재 7MB 제한으로 413. 원본 33–44, 282–283쪽을 그대로 복사한 21번 fixture로 실제 API→Student 8개 문장쌍 검증. 전체 모의고사 Student 등록을 뜻하지 않음.

## 26년 9월 고2 모의고사 21~40번.pdf

- 원본: 20쪽 · SHA-256 `c310ae6e2960eefc91ce29d69b41c64684a4f077557b35986b8da027368c8580`
- source provenance: publisher 없음 / PURE = canonical_passage
- Factory에서 검증된 publisher 문항: 한글 0 / 영어 0 / 동사형 0 / 어법 0 / 어순 0 / 영작 0
- Factory unresolved: 0 (canonical 자체가 차단된 group은 별도)
- [canonical + Factory/PURE artifact](expected/mock-2026-september-grade2-text.factory.json)
- [실제 Studio + Student catalog artifact](expected/mock-2026-september-grade2-text.student.json)

- 사용자의 최종 지정에 따라 21–40번 전체 포함. 18–28 제한을 적용하지 않음.
- 27·28번 안내문의 영/한 혼합행·제목은 기존 검토 단계의 수정 입력으로 보존. 다른 지문은 현재 importer의 문장쌍 단위를 유지.
- publisher authored source 없음. 검토 후 20개 Passage / 158개 문장쌍의 PURE 3종 모두 생성됨.

## 실행 / 보관

- 전체: `npm run ready:test:full` (공개 기본 회귀 + 비공개 PDF 회귀)
- PDF만: `npm run ready:test:pdf`
- 공개 CI: `npm run ready:test` — 원본 PDF gate를 포함하지 않음
- fixture의 원본·검토 입력·normalized 전체 결과는 로컬 비공개 보관. 경로를 바꿀 때 `READY_PDF_FIXTURE_DIR` 지정.
- B audit/최적화는 사용자의 요청에 따라 진행하지 않음.
