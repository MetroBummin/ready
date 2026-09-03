# READY Workbook Import

## Fixed pipeline

1. 원본 PDF의 파일명과 SHA-256을 기록하고 원본을 보존한다.
2. PDF 텍스트층에서 단계별 exercise를 추출한다.
3. 출판사가 제공한 영문·우리말·정답을 source of truth로 계약을 만든다.
4. frame을 정답으로 다시 채웠을 때 출판사 원문이 재현되는지 검증한다.
5. 검증 성공 exercise만 `READY` catalog에 넣는다.
6. 현재 interaction이 없으면 `UNSUPPORTED`, 원문/정답 연결을 증명하지 못하면 `INVALID`로 기록하고 학생에게 보내지 않는다.

PDF 전체를 폐기하지 않는다. `unpublishedExercises`에는 INVALID exercise의 stage, number,
source, prompt, reason을 남긴다. 현재 학생 학습 범위는 2~9단계이며, 이 범위의 모든 단계는
공통 contract로 지원한다. 1단계 읽기 원본과 10단계 mixed Check는 현재 범위 밖이다.

## Contract rules

- renderer가 단계명, 빈칸 개수, 문자열 모양으로 interaction을 추측하지 않는다.
- `kind`, `prompt`, `answers`, `groups`, `hints`, `wordBank`가 실행 방법을 완전히 명시한다.
- 어법 선택은 모든 조합 중 출판사 전체 영문에 유일하게 존재하는 조합만 READY다.
- 7단계는 본문 전체와 출판사 정답표의 오류/교정 쌍을 계약에 넣으며, PDF의 밑줄 좌표를
  renderer가 다시 추측하지 않는다.
- 영작은 PDF의 부분 frame을 유지하고 실제 빈칸만 만든다.
- 해석은 출판사 해석을 비공개 semantic reference로 사용한다.
- 특정 교재명이나 문항 번호를 위한 repair rule은 추가하지 않는다.

일반 추출기: `tools/ready-extract-workbook-contract.py`

새 PDF에서 기존 규칙으로 충분한 READY exercise를 얻지 못하면 importer를 즉시 확장하지
말고 실패 이유를 먼저 분류한다. 여러 문서에 반복되는 일반 패턴일 때만 계약을 확장한다.

## Workbook Factory input

Admin Factory는 다음 입력을 같은 canonical sentence review 단계로 모은다.

- 텍스트층이 있는 전체 Workbook PDF
- 영문 본문과 출판사 해석이 함께 있는 PDF
- 영문/우리말 교대 텍스트
- `English<TAB>Korean` 두 열 TSV
- 영문만 있는 본문 텍스트(출판사 해석이 없음을 명시하고 review에서 멈춤)

Factory에는 두 target mode가 있다.

- `new_passage`: review에서 확정한 문장쌍으로 Passage와 sentence rows를 만든 뒤 catalog를 연결한다.
- `existing_passage`: 관리자가 선택한 Passage의 `ready_passage_sentences`를 유일한 canonical
  source로 사용하며, Passage/sentence/Question/Attempt/exam link를 생성하거나 수정하지 않는다.
  PDF가 있으면 exercise와 Answer Key만 추출하고 PDF 본문은 canonical rows와의 일치 검사에만
  사용한다. 기존 factory catalog 또는 code-backed workbook이 있으면 시작과 확정 시점 모두 막는다.

이미 게시된 Factory catalog는 일반 생성 mode로 덮어쓰지 않는다. Admin의 명시적 `factory_regenerate`
경로만 원본 factory job, 현재 canonical sentence snapshot, 최신 validator를 다시 확인한 뒤 같은
`passage_id`의 catalog row를 원자적으로 update한다. 검증 중에는 기존 catalog를 삭제하지 않으며,
5·6·7단계 coverage가 불완전하면 기존 catalog를 유지한 채 재생성을 중단한다. code-backed workbook은
이 경로에서도 변경할 수 없다.

`existing_passage` review의 문장쌍은 읽기 전용이다. Factory 시작 후 canonical rows가 바뀌면
스냅샷 검증을 실패시키고 새 작업을 요구한다. 최종 validator를 통과한 catalog만 기존
`passage_id`로 insert하며, `ready_workbook_catalogs.passage_id` 기본키가 동시 중복도 막는다.

Factory Stage 5·6은 canonical 문장별 coverage를 계산하고, 출판사 source에서 검증된 문항이
없는 sentence만 Gemini fallback 대상으로 보낸다. Stage 7의 출판사 passage/range 문항은
여러 correction pair를 하나의 exercise로 보존하며, source가 전혀 없을 때만 문장별 fallback을
사용한다. 최종 5·6·7 coverage가 기대 수량보다 적으면 바로 게시하지 않고 Admin 확인을 요구한다.
Stage 8의 generated order bank는 한 영어 단어당 chip 하나를 사용한다.

Gemini fallback 뒤에도 6·7단계가 비면 검증된 5·6단계의 answer boundary에서 오답 선택지와
correction pair를 결정론적으로 파생한다. 파생 문항도 정답을 대입했을 때 canonical English가
정확히 복원되는 경우만 READY이며, metrics의 `derivedFallbackExercises`로 별도 집계한다.
재생성은 기존 PDF/source exercise를 우선 재사용하고 AI 호출 없이 실행한다. 비어 있는
5단계는 canonical English에서 일반 동사 활용 규칙으로 base form이 명확한 경우만
결정론적으로 복구하며, 불확실하면 기존 catalog를 유지하고 재생성을 멈춘다.
Edge 재생성은 자원 한도 안에서 끝나도록 단계별 최대 6문장의 Gemini batch를 한 차례만
실행하고, 그 후 남은 6·7단계를 위 검증 절차로 채운다. 전체 문장 수와 관계없이 Gemini
호출은 5·6·7단계 각 1회, 최대 3회로 제한된다.

PDF는 PDF.js의 표준 Unicode text layer로 읽고 페이지 표지만 보존한다. 출판사명, 파일명,
페이지 좌표, 폰트명 또는 임의 x 좌표로 열을 추측하지 않는다. 스캔 PDF나 손상된 문자맵은
조용히 일부만 수용하지 않고 review/unsupported로 멈춘다.

전체 Workbook에서 번호가 일치하는 2단계 영문과 3단계 우리말을 canonical pair로 만들고,
5·6·7단계는 출판사 문제와 Answer Key의 같은 번호를 연결한다. 원문을 복원하는 round-trip이
성공한 source exercise를 먼저 재사용하며, 부족한 번호만 한 번의 구조화 배치 생성 대상으로
보낸다. 2·3·4·8·9단계는 검토가 끝난 canonical pair에서 결정론적으로 생성한다.

Factory는 문장쌍이나 정답 연결이 불완전한 상태에서 일부 catalog를 publish하지 않는다.
각 exercise validator 실패만 INVALID로 남기며, 기존 학생 Attempt/Review 데이터는 append-only
정책을 그대로 따른다.
