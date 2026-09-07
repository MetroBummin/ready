# READY Workbook Contract

워크북은 PDF 뷰어가 아니라 학생이 직접 입력하고 서버에서 채점받는 별도 학습 흐름이다.
Question과 Workbook은 같은 Passage를 참조할 수 있지만 서로의 문제 장치와 시도 기록을
공유하지 않는다.

## PDF inventory

공통영어2 NE능률(민병천) 1과 10단계 워크북은 46쪽이다. 1~41쪽은 10개 학습 단계,
42~46쪽은 정답표다.

- 1단계: 본문 읽기/해석
- 2단계: 영문을 보고 우리말 빈칸 41문항
- 3단계: 우리말을 보고 영문 빈칸 41문항
- 4단계: 해석 직접 쓰기
- 5단계: 동사 형태
- 6단계: 어법 선택
- 7단계: 오류 고치기
- 8단계: 어순 배열
- 9단계: 영작
- 10단계: 종합

Workbook PDF는 보존되는 원본 패키지다. 공개 판정은 파일이 아니라 exercise 단위다.

- `READY`: 원문 frame과 출판사 정답이 round-trip으로 재현되어 학생에게 공개한다.
- `UNSUPPORTED`: 원문과 provenance는 유지하지만 현재 interaction이 없어 숨긴다.
- `INVALID`: 해당 exercise의 frame/정답 연결을 증명하지 못해 숨긴다.

단계 번호는 READY의 학습 의미 계약이다. 출판사 PDF에 인쇄된 번호를 그대로 복사하지 않는다.
예를 들어 PDF의 `Workbook 9`가 문단 배열이고 `Workbook 10`이 영작이면, 의미상 영작인
`Workbook 10`을 READY 9단계로 가져온다. 문단 배열은 현재 READY 9로 변환하지 않고
`UNSUPPORTED`로 원본만 보존한다.

현재 학생 학습 범위는 2~9단계다. 2·3·5·6·8단계는 결정론적으로 채점하고, 4단계 해석은
출판사 해석을 semantic reference로 삼아 AI가 채점한다. 7단계는 출판사 정답표의
오류/교정 쌍을 명시적으로 입력받아 결정론적으로 채점한다. 9단계는 PDF의 의미상 영작
section에서 부분 문장 frame과 출판사 정답을 가져와 실제 빈칸만 결정론적으로 채점한다.
영작 section을 구조화하지 못했을 때 canonical 문장 전체를 임의의 한 칸 영작으로 만들지
않는다. 해당 exercise는 `UNSUPPORTED` 또는 `INVALID`로 비공개 유지한다. 1단계 읽기 원본과
mixed Check는 현재 학습 범위 밖으로 원본만 보존한다.

## Runtime contract

- `student_workbook`: 접근 가능한 Passage의 공개 item과 최신 진도만 반환한다.
- `submit_workbook_attempts`: 기기에서 판정한 여러 응답을 한 요청으로 다시 검증하고 append-only 시도를 남긴다. `client_attempt_id`는 재전송 중복만 막으며 과거 시도를 덮어쓰지 않는다.
- 인증된 학생에게 배정된 deterministic Workbook은 catalog와 함께 정답·recall·prefix 계약을 한 번 받는다. 화면에는 제출 전 정답을 표시하지 않지만 DevTools 수준의 answer secrecy는 성능을 위해 보장하지 않는다.
- 한국어·영어 recall은 메모리의 계약으로 첫 음절/글자가 맞는 즉시 전체 slot을 완성하며, slot별 서버 해제 요청을 사용하지 않는다.
- semantic `writing`은 같은 catalog에 포함된 prefix 계약으로 실시간 오류를 표시하고, 명시적으로 요청한 전체답 힌트만 서버 receipt를 받는다.
- deterministic 결과는 먼저 기기에서 표시한다. Attempt 저장과 Review/progress 동기화는 로컬 영속 queue에서 background batch로 처리하고 서버는 같은 규칙으로 다시 검증한다.
- 단계 진도는 current cycle의 `item_key`별 최초 정답만 센다. 모든 item을 한 번씩 clear하면 100% cycle을 닫고 빈 unique set으로 다음 cycle을 시작한다. 같은 cycle의 중복 정답과 오답은 진도를 올리지 않는다.
- 2·3단계의 미세 오타는 Attempt가 아니며, 모든 slot recall 완료 시 한 번만 append한다.
- semantic `writing`의 전체답 힌트는 제출을 막지 않지만 해당 Attempt를 오답으로 기록하고 Review에 남긴다.
- 해석 AI는 새로운 정답을 만들지 않고 비공개 출판사 해석과 의미만 비교한다.
- 틀린 제출 뒤에만 해당 빈칸의 정답을 보여 준다.
- `ready_workbook_attempts`는 원시 기록을 수정하거나 삭제하지 않는다.
- 오답은 exercise 단위로 Review에 자동 저장되고, 정답 처리되면 자동 오답 상태만 해소한다.
- 수동 북마크는 정답 여부와 무관하게 사용자가 직접 해제할 때까지 유지한다.
- Review에서 해당 exercise를 열 때도 원래 Workbook renderer를 그대로 사용한다.
- Writing Attempt는 `hint_count`, `used_full_answer_hint`, `completed_after_hint`를 함께 보존한다.

일반 추출기는 `tools/ready-extract-workbook-contract.py`다. 카탈로그마다 원본 파일명과
SHA-256, 단계별 `source / ready / invalid` 수를 남긴다. 7단계도 교재별 예외 없이 같은
추출기와 answer-key-backed contract를 사용한다.
# READY Workbook semantic contract (v2)

READY Workbook has exactly seven active semantic stages:

1. `korean_blank` — Korean blank recall
2. `english_blank` — English blank recall
3. `translation` — full Korean translation
4. `verb_form` — publisher verb-form slots
5. `grammar_choice` — publisher grammar/vocabulary choices
6. `word_order` — sentence-level, one English word per chip
7. `writing` — Korean meaning to the whole canonical English sentence

Source workbook numbers are provenance only. Paragraph ordering, correction,
reading-only and ambiguous mixed exercises are unsupported. Workbook AI
generation is disabled; only submitted `translation` responses use semantic AI
grading against the private canonical Korean reference. Missing source is never
synthesized.

Every active catalog declares `contractVersion: semantic-v2`; every stage and
item declares its `semanticType`. Historical attempts remain `legacy-v1`, so an
old correction stored as stage 7 can never be interpreted as new writing.

## Live canonical Passage

Passage-only deterministic generation uses every active canonical `SENTENCE` to create exactly
three safe practices: `translation`, `word_order`, and `writing`. It never reads PDF layout or calls
AI. `TITLE` and `SUBTITLE` are renderer structure only and never become Workbook items. Saving a
canonical edit increments the Passage revision and automatically rebuilds this core while retaining
verified publisher-only stages. Publication compares the expected revision and atomically replaces
the catalog, so a failed build keeps the last good student catalog. Attempts and review history are
append-only and independent from catalog regeneration.

## Studio annotation contract

The semantic stages 1–7 above remain unchanged. Pure is translation (3),
word_order (6), writing (7); Authored is korean_blank (1), english_blank (2),
verb_form (4), grammar_choice (5). Studio AI can propose authoring targets, while
Student AI is limited to semantic translation grading. Catalog regeneration and
all non-translation Student grading remain deterministic.

A target is `{span:{sentenceId,tokenStart,tokenEnd,quote,prefix,suffix}}`.
`tokenEnd` is exclusive. Tokens are Unicode letter/number words with internal
apostrophes/hyphens; punctuation and spaces between selected tokens are retained
in the exact quote. The owning step chooses English or Korean text. Verb form
also requires `hint` and `answer`; grammar choice requires `correct` and one
`distractor`. Correct/answer must reproduce the selected canonical surface.

Per-sentence English/Korean snapshots invalidate only changed rows. TITLE and
SUBTITLE cannot own authoring or Pure exercises. Human confirmation is separate
from ending a mouse selection. Selecting a distant word finishes editing the
previous span, but does not publish or human-confirm that step.
