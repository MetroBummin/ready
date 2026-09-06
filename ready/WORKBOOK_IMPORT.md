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

Admin Factory의 공식 입력은 다음 두 가지뿐이며, 둘 다 게시 전에 Passage Editor의
`Passage Draft` 단계로 모인다.

- 텍스트층이 있는 전체 Workbook PDF
- 영문 본문과 출판사 해석이 함께 있는 PDF
- `English<TAB>Korean` 두 열 TSV

CSV/HWP/DOCX, 교대 줄 텍스트, 영문-only paste는 공식 입력이 아니다.

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

게시된 Passage도 Passage Editor에서 계속 수정한다. TITLE/SUBTITLE/SENTENCE와 문단 번호는
구조 metadata이며 TITLE/SUBTITLE은 Workbook item이 아니다. 기존 row는 id를 유지하고,
삭제한 row는 historical FK 보존을 위해 inactive로 남긴다. 저장하면 canonical revision을
올리고 `translation`, `word_order`, `writing` deterministic core를 자동 생성·검증한 뒤
catalog를 원자 교체한다. 실패 시 canonical 수정은 남고 이전 정상 catalog는 유지된다.
AI 호출은 발생하지 않으며 AI artifact는 `재생성 필요` 상태만 된다.

generator 코드가 바뀌면 Admin의 지문별 또는 전체 deterministic 재생성을 사용한다. 각 Passage는
독립적으로 검증·교체되며 AI 전체 재생성 경로는 존재하지 않는다. `npm run workbook:check`는
DB/AI/publish 없이 동일 generator의 contract만 검사한다.

Full PDF의 publisher exercise는 Answer Key와 canonical round-trip이 검증된 경우에만 별도
source exercise로 보존한다. PDF의 괄호, slash, correction span, printed stage 번호를 근거로
canonical 문장을 다시 추측하지 않는다. 검증하지 못한 exercise는 INVALID로 남기며 AI로
채우지 않는다. PDF에서 추출한 전체 `sourceExercises`는 Factory job에만 보존하고 catalog
provenance에는 문서 해시·파일명·추출 수량 등 재현에 필요한 요약만 둔다.

PDF는 PDF.js의 표준 Unicode text layer로 읽고 페이지 표지만 보존한다. 출판사명, 파일명,
페이지 좌표, 폰트명 또는 임의 x 좌표로 열을 추측하지 않는다. 스캔 PDF나 손상된 문자맵은
조용히 일부만 수용하지 않고 review/unsupported로 멈춘다.

전체 Workbook에서 번호가 일치하는 2단계 영문과 3단계 우리말을 canonical pair로 만들고,
출판사 문제와 Answer Key는 같은 source identity로 연결한다. 원문을 복원하는 round-trip이
성공한 source exercise만 재사용하며, 부족한 source exercise를 AI나 추측으로 채우지 않는다.

Factory는 문장쌍이나 정답 연결이 불완전한 상태에서 일부 catalog를 publish하지 않는다.
각 exercise validator 실패만 INVALID로 남기며, 기존 학생 Attempt/Review 데이터는 append-only
정책을 그대로 따른다.
# Deterministic semantic import

The only publication path is:

`original PDF + Answer Key + canonical passage -> deterministic classifier -> semantic validator -> atomic catalog replacement`

Classification priority is explicit heading/instruction, local exercise
structure, Answer Key structure, then canonical alignment. A printed Workbook
number never determines a READY stage. Unknown or ambiguous source remains
private. No canonical-derived filler and no Gemini fallback are allowed.

Before replacing an active production catalog, all 13 production sources must
be present, dry-run diffs must be reviewed, semantic validation and golden
regression must pass, and unresolved must equal zero. Missing source blocks the
entire replacement. Passage/sentence identity, Questions, exam links, attempts,
bookmarks and history are never rewritten by catalog regeneration.
