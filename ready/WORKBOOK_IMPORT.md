# READY Workbook Import

## Fixed pipeline

1. 원본 PDF의 파일명과 SHA-256을 기록하고 원본을 보존한다.
2. PDF 텍스트층에서 단계별 exercise를 추출한다.
3. 출판사가 제공한 영문·우리말·정답을 source of truth로 계약을 만든다.
4. frame을 정답으로 다시 채웠을 때 출판사 원문이 재현되는지 검증한다.
5. 요청된 Authoring 4종 전체가 검증된 지문만 `READY` catalog에 원자적으로 넣는다.
6. 원문/정답 연결을 증명하지 못한 지문은 기존 학생용 catalog를 유지하고 보류한다.

원본 PDF 바이트, SHA-256, 파일/보존 위치, 문제·정답 페이지, source exercise ID,
추출 결과와 validator 버전을 private Factory job에 함께 보존한다. 현재 import 범위는
Authoring 4종(한글 빈칸, 영어 빈칸, 동사형, 어법선택)과 deterministic AUTO 3종
(해석, 어순배열, 영작)이다. 문단배열·어색한 곳 찾기 등은 새 학습 유형으로 만들지 않는다.

## Contract rules

- renderer가 단계명, 빈칸 개수, 문자열 모양으로 interaction을 추측하지 않는다.
- `kind`, `prompt`, `answers`, `groups`, `hints`, `wordBank`가 실행 방법을 완전히 명시한다.
- 어법 선택은 모든 조합 중 출판사 전체 영문에 유일하게 존재하는 조합만 READY다.
- 7단계는 본문 전체와 출판사 정답표의 오류/교정 쌍을 계약에 넣으며, PDF의 밑줄 좌표를
  renderer가 다시 추측하지 않는다.
- 영작은 PDF의 부분 frame을 유지하고 실제 빈칸만 만든다.
- 해석은 출판사 해석을 비공개 semantic reference로 사용한다.
- 특정 교재명이나 문항 번호를 위한 repair rule은 추가하지 않는다.

공통 추출/검증기는 `server/ready/workbook-factory.mjs`, 공통 변환기는
`server/ready/studio-import.mjs`, 공통 저장 endpoint는 `studio_publisher_import`이다.
CLI와 Admin은 모두 이 endpoint를 사용한다.

새 PDF에서 기존 규칙으로 충분한 READY exercise를 얻지 못하면 importer를 즉시 확장하지
말고 실패 이유를 먼저 분류한다. 여러 문서에 반복되는 일반 패턴일 때만 계약을 확장한다.

## Workbook Factory input

Admin Factory의 공식 입력은 자료 종류에 따라 분리된다.

- `전체 Workbook · 출판사 원본 검증`: 텍스트층이 있는 전체 Workbook PDF를 즉시 dry-run하고,
  검증 통과 결과만 시스템 승인으로 발행한다.
- `본문·해석만`: 영문 본문과 출판사 해석이 있는 PDF 또는 TSV를 Passage Draft로 가져오며
  Authoring을 자동 생성하지 않는다.
- `English<TAB>Korean` 두 열 TSV

CSV/HWP/DOCX, 교대 줄 텍스트, 영문-only paste는 공식 입력이 아니다.

Factory에는 두 target mode가 있다.

- `new_passage`: review에서 확정한 문장쌍으로 Passage와 sentence rows를 만든 뒤 catalog를 연결한다.
- `existing_passage`: 관리자가 선택한 Passage의 `ready_passage_sentences`를 유일한 canonical
  source로 사용하며, Passage/sentence/Question/Attempt/exam link를 생성하거나 수정하지 않는다.
  PDF가 있으면 exercise와 Answer Key만 추출하고 PDF 본문은 canonical rows와의 일치 검사에만
  사용한다. 기존 factory catalog 또는 code-backed workbook이 있으면 시작과 확정 시점 모두 막는다.

전체 Workbook 복구는 기존 `passage_id`를 명시한다. importer는 현재 canonical 행의 ID·순서·본문·해석을
읽어 PDF와 대조하지만 이를 수정하지 않는다. 성공 시 Studio annotation과 학생용 catalog를 한 트랜잭션으로
교체하며, 실패 시 둘 다 기존 상태를 유지한다. PDF SHA-256과 Passage ID의 source identity가 같은 성공
작업은 재실행해도 새 지문·문항을 만들지 않는다.

게시된 Passage도 Passage Editor에서 계속 수정한다. TITLE/SUBTITLE/SENTENCE와 문단 번호는
구조 metadata이며 TITLE/SUBTITLE은 Workbook item이 아니다. 기존 row는 id를 유지하고,
삭제한 row는 historical FK 보존을 위해 inactive로 남긴다. 저장하면 canonical revision을
올리고 `translation`, `word_order`, `writing` deterministic core를 자동 생성·검증한 뒤
catalog를 원자 교체한다. 실패 시 canonical 수정은 남고 이전 정상 catalog는 유지된다.
AI 호출은 발생하지 않으며 AI artifact는 `재생성 필요` 상태만 된다.

generator 코드가 바뀌면 Admin의 지문별 또는 전체 deterministic 재생성을 사용한다. 각 Passage는
독립적으로 검증·교체되며 AI 전체 재생성 경로는 존재하지 않는다. `npm run workbook:check`는
DB/AI/publish 없이 동일 generator의 contract만 검사한다.

Full PDF의 publisher exercise는 문제틀·선택지/힌트·Answer Key·완성 canonical의 round-trip이 모두
검증된 경우에만 보존한다. 밑줄 수와 slash 수가 다를 수 있으므로 인접 밑줄은 완성 문장으로 유일하게
증명되는 경우에만 묶거나 나눈다. `It's` 같은 축약형 동사 문제는 `It`을 고정하고 `is`를 정답으로 둔다.
검증 실패를 AI 또는 canonical 기반 임의 출제로 채우지 않는다.

PDF는 PDF.js의 표준 Unicode text layer로 읽고 페이지 표지만 보존한다. 출판사명, 파일명,
페이지 좌표, 폰트명 또는 임의 x 좌표로 열을 추측하지 않는다. 스캔 PDF나 손상된 문자맵은
조용히 일부만 수용하지 않고 review/unsupported로 멈춘다.

전체 Workbook에서 번호가 일치하는 2단계 영문과 3단계 우리말을 canonical pair로 만들고,
출판사 문제와 Answer Key는 같은 source identity로 연결한다. 원문을 복원하는 round-trip이
성공한 source exercise만 재사용하며, 부족한 source exercise를 AI나 추측으로 채우지 않는다.

Factory는 문장쌍이나 요청된 Authoring 4종의 정답 연결이 불완전한 지문을 일부 성공으로 publish하지
않는다. 여러 PDF 중 정상 지문은 계속 처리하며 실패 지문은 기존 데이터를 유지한다. 승인 출처는
`publisher_verified` / `publisher_system_validation`이고 teacher/manual 확정으로 기록하지 않는다.

## 공식 일괄 명령

먼저 JSON manifest에 각 PDF와 기존 Passage를 명시한다.

```json
{
  "entries": [
    {"file": "/absolute/path/21.pdf", "passageId": "existing-passage-uuid"},
    {"file": "/absolute/path/new.pdf", "title": "새 지문 제목", "sourceType": "MOCK_EXAM", "grade": "1학년", "sourceYear": 2026, "sourceMonth": 9}
  ]
}
```

```bash
# 모든 파일 추출·검증 및 변경 내역만 출력
READY_ADMIN_PASSWORD='...' npm run workbook:import -- --manifest /absolute/path/import.json

# 먼저 전 파일 dry-run 후, 통과한 지문만 지문별 원자 적용
READY_ADMIN_PASSWORD='...' npm run workbook:import -- --manifest /absolute/path/import.json --apply
```

운영 반영 전 `npm run workbook:check`를 실행한다. 적용 후에는 API/DB를 다시 읽어 각 stage의 문항,
빈칸 수, 힌트, 선택지, 정답과 provenance를 확인한다.
# Deterministic semantic import

The only publication path is:

`original PDF + Answer Key + canonical passage -> deterministic classifier -> semantic validator -> atomic catalog replacement`

Classification priority is explicit heading/instruction, local exercise
structure, Answer Key structure, then canonical alignment. A printed Workbook
number never determines a READY stage. Unknown or ambiguous source remains
private. No canonical-derived filler and no Gemini fallback are allowed.

Before replacing an active production catalog, that passage's complete source
PDF must be present, its dry-run diff must be reviewed, semantic validation and
golden regression must pass, and unresolved must equal zero. Missing source
blocks that passage only. Passage/sentence identity, Questions, exam links,
attempts, bookmarks and history are never rewritten by catalog regeneration.

## Passage Studio (current authoring path)

Admin has three top-level destinations: 학생 관리, 시험범위, Studio. Studio extends
Factory jobs and the live canonical editor; the historical Question APIs and
legacy catalogs retain their contracts. The source-only rules above remain for
legacy Factory imports, while Studio uses the teacher-confirmed annotation as
publication authority.

PDFs can contain multiple Passages; multiple files are imported independently.
Explicit passage labels separate source pages and answer sections. In the
passage-only path, ambiguous boundaries remain review-required and can be split,
merged within one document, reordered, or renamed before creating independent
Drafts. The full-Workbook path never permits correcting canonical rows as an
import shortcut. PDF byte SHA-256, filename, pages, and publisher exercises stay
in the original Factory job. Import never calls an AI provider. TSV remains the
only paste format.

Each active SENTENCE owns four annotation records: english_blank, korean_blank,
verb_form, grammar_choice. Each target stores the sentence ID and a zero-based
half-open token range; quote/context is validation and conservative rebasing
metadata, not identity. A repeated word is distinguished by token position.
Adjacent clicks extend the active span, endpoint clicks shrink it, and a distant
click starts a separate target. All four steps share this interaction.

Authoring uses the existing Gemini provider only on explicit teacher action and
only for dirty sentences. Validated publisher candidates win. Provider output
is unconfirmed; each sentence/step is reviewed and confirmed before publication.
An explicitly confirmed empty target list means there is no suitable target for
that sentence and step. Invalid spans, overlapping spans, missing verb hints,
and non-unique grammar answers block confirmation/publication.

Canonical edits rebase exact retained targets when unambiguous and mark only the
changed sentence stale; removed sentences retain retired annotations. Pure
translation/word_order/writing retain unchanged item payloads and keys. Catalog
regeneration never calls AI or reparses PDFs; it compiles Pure and currently
confirmed Authored records. Drafts do not create a student catalog until Publish.
Published canonical edits omit stale authored items pending review. Attempts and
history are not mutated. Revision and Studio version checks reject concurrent
annotation/publish writes; a failed transaction keeps the previous catalog.

Release order: apply the additive `ready_passage_studio` migration before
releasing the matching API/Admin. It adds one private JSON state column and two
service-role-only RPCs. It does not migrate production catalogs or learning data.
