# READY Question Type Contract

## Render specification

데이터의 문제 유형은 세밀하게 분류하되 학생 화면은 `standard_mcq`, `annotated_passage_mcq`, `structural`, `summary`, `written_input` 다섯 renderer만 사용한다.

renderer는 taxonomy 이름이나 한국어 발문을 보고 화면을 추측하지 않는다. 새 Question은 `payload.taxonomy`, `payload.import_status`, `payload.spec`으로 본문 출처, 허용 annotation/block, 응답 방식과 채점 방식을 완전히 선언한다. 명세에 없는 요소는 처음부터 렌더하지 않는다.

`import_status`는 `ready`, `drop` 두 개뿐이다. 검증된 `ready`만 `status=available`로 공개한다. 애매하거나 계약이 깨진 문제는 학생 화면의 휴리스틱으로 수리하지 않고 `drop`으로 폐기한다.

세밀한 taxonomy는 데이터 분류용이고 renderer는 다섯 개뿐이다. renderer는 taxonomy 이름을 해석하지 않고, 명세가 선언한 passage block, annotation, extra block, response mode만 그린다. PDF 해시·페이지·bbox는 import/debug provenance이며 학생 runtime의 렌더링 의존성이 아니다.

이 문서와 `QUESTION_IMPORT.md`는 READY Question 작업의 source of truth다. 현재 계약은 2026년 6월 부산 고2 예상문제 원문 18~28번의 137문항을 조사한 결과만 반영한다.

## Product boundary

1. READY는 Question-first 제품이다: 가져오기/생성 → 풀이 → 서버 채점 → Attempt → 오답 복습을 우선한다.
2. Reader와 Question passage는 sentence card가 아닌 연속된 plain prose다.
3. 학생 runtime에는 word lookup, sentence translation, SavedWord, SavedSentence, lexical highlight를 연결하지 않는다. 기존 DB 데이터와 서버 함수는 삭제하지 않는다.
4. `ready_passages`와 `ready_passage_sentences`가 canonical source다. Question이 canonical을 수정하거나 덮어쓰면 안 된다.
5. `ready_attempts`는 append-only다. 별도 WrongAnswer 테이블을 만들지 않는다.
6. 학생에게 배정된 현재 practice 묶음은 즉시 deterministic 피드백을 위해 정답·해설 계약을 함께 받을 수 있다. UI는 제출 전 이를 표시하지 않고, 서버는 Attempt 저장 시 독립적으로 다시 채점한다.

## 두 response contract

화면 family는 다섯 개지만 저장/채점 계약은 두 개뿐이다.

### `multiple_choice`

```json
{
  "type": "multiple_choice",
  "payload": {
    "family": "standard",
    "skill": "topic",
    "prompt": "...",
    "choices": ["...", "...", "...", "...", "..."],
    "answer": [1],
    "multi_select": false
  }
}
```

- `answer`는 zero-based index 배열이다.
- single은 index 한 개, multi는 정렬된 set equality로 채점한다.
- `answer`는 `publicQuestion()`이 반환하지 않는다.

### `written_response`

```json
{
  "type": "written_response",
  "payload": {
    "family": "written",
    "prompt": "...",
    "response_slots": [{"label": "(1)"}, {"label": "(2)"}],
    "accepted_answers": [["answer one"], ["answer two", "allowed alternative"]],
    "accepted_response_sets": [["answer one", "answer two"]]
  }
}
```

- slot마다 허용 정답 문자열을 한 개 이상 둔다.
- 서로 연동된 빈칸(예: 두 단어의 순서 교환)은 `accepted_response_sets`로 허용되는 전체 조합만 지정한다.
- 서버가 NFKC, case folding, 문장부호 제거, 연속 공백 축약 후 정확히 비교한다.
- PDF 18~28의 고쳐쓰기, 배열, 조건형 영작, 빈칸 요약은 이 방식으로 deterministic grading이 가능했다.
- 결정론적 비교로 확정되지 않은 자유 응답은 저장 후 AI grading fallback을 사용한다.

## 다섯 renderer family

### A. Standard Multiple Choice (`family: standard`)

주제, 제목, 요지, 목적, 심경, 내용 일치/불일치. `prompt → prose/content blocks → choices`를 사용한다.

### B. Annotated Multiple Choice (`family: annotated`)

빈칸, 함축, 어법, 어휘. raw HTML 대신 다음 두 표현 중 하나를 사용한다.

```json
{"variant_segments":[
  {"kind":"text","text":"Events that could happen but "},
  {"kind":"choice","label":"ⓐ","text":"[isn't / aren't]"},
  {"kind":"text","text":" likely ..."}
]}
```

허용 `kind`: `text`, `blank`, `underline`, `label`, `choice`, `emphasis`.

### C. Structural Multiple Choice (`family: structural`)

문장 삽입, 무관한 문장, 글의 순서. drag-and-drop 대신 PDF의 선택지를 그대로 사용해 deterministic grading한다.

```json
{
  "stimulus":"주어진 문장",
  "content_blocks":[
    {"kind":"given","text":"intro"},
    {"kind":"group","label":"(A)","text":"..."},
    {"kind":"group","label":"(B)","text":"..."}
  ]
}
```

### D. Summary Completion (`family: summary`)

선택형이면 `multiple_choice`, 직접 입력이면 `written_response`를 사용한다. 요약문은 `summary_text`로 Passage와 분리해 표시한다.

### E. Written Response (`family: written`)

`response_slots`와 `accepted_answers`를 사용한다. 정확 비교가 먼저 실행되고, 의미적 자유도가 큰 답안은 같은 출판사 정답과 조건을 rubric으로 삼아 AI가 보조 판정한다.

## Canonical, variant, special content

- 변형 없음: canonical sentence를 이어 붙인 `passageText`를 서버가 제공한다.
- 단순 전체 변형: `payload.variant_text`.
- 출제자가 문장 내용이나 표현을 의도적으로 바꾼 변형 지문: `payload.variant_text`와
  `payload.variant_mode: "authored_variant"`를 함께 둔다. 이 모드에서는 READY가
  canonical Passage와 다르다는 이유로 문장을 복원하거나 교체하지 않는다.
- 원문을 유지하고 현재 문제의 빈칸·기호·밑줄만 올리는 기본값은
  `payload.variant_mode: "canonical_overlay"`다. 필드를 생략해도 이 기본값으로 본다.
- 빈칸/밑줄/표지: `payload.variant_segments`.
- 순서/안내문/도표: `payload.content_blocks`.
- 허용 block kind: `heading`, `paragraph`, `given`, `group`, `bullet`, `note`, `image`.
- image block은 `url`, `alt`, `caption`만 공개한다. Passage 25의 그래프처럼 시각 자료가 풀이에 필수인 경우에만 쓴다.

Question public contract:

```text
id, type, family, skill, prompt, choices, multiSelect,
responseType, responseSlots,
passageText, variantText, variantMode, variantSegments, contentBlocks,
stimulus, summaryText, source
```

`answer`와 `accepted_answers`는 포함하지 않는다.

## Source metadata

모든 imported Question은 아래 metadata를 `payload.source`에 보존한다.

```json
{
  "provider": "exam4you",
  "exam": "2026-06 부산 고2 예상문제",
  "passage_no": 20,
  "source_question_no": 213,
  "section": "3"
}
```

NE 교과서 문제는 `payload.source_kind`를 `textbook_main`, `dialogue`,
`supplemental`중 하나로 검증한다. 학생 풀이, Home 미풀이 개수, Review queue는
`textbook_main`만 공유한다. 과거 import에서 `source_kind`가 없는 경우에만 canonical
Passage와의 영어 bigram 일치를 하위 호환 검증으로 사용한다.

`payload.source.set_id`는 같은 PDF 지문에서 파생되었다는 출처 정보일 뿐이다. 출제,
풀이 상태, 랜덤/유형/난이도 필터의 최소 단위는 항상 개별 Question ID다. 학생 화면은
현재 Question의 `set_text`와 장치만 렌더링하며 이웃 Question의 빈칸·밑줄·기호를 합치지 않는다.

## Shorts와 Review

학생 문제 풀이는 한 화면에 한 문제만 보여 주는 Shorts 방식이다. 모바일은 세로 스와이프, 데스크톱은 휠·트랙패드, 키보드는 위·아래 방향키로 이동한다. 긴 문제는 화면 내부를 끝까지 읽은 뒤 추가 동작이 있어야 다음 문제로 넘어간다.

기본 저장 계약은 **1 READY card = 1 independently answerable Question**이다. 같은 canonical Passage에서 요지·어법·빈칸·내용·영작을 각각 출제하면 다섯 개의 독립 `ready_questions`와 다섯 개 Shorts card로 저장한다. 중복 표시를 피하려고 canonical을 축약하지 않는다. 하나의 발문이 복수 정답이나 여러 답칸을 요구할 때만 한 Question 안에 유지하며, 서로 독립된 발문을 한 card에 합치지 않는다.

Home의 `문제풀기`는 먼저 source와 taxonomy 필터를 보여 준다. source는 `전체`,
`exam4you`, `nernter` 중 하나를 선택하고 taxonomy는 여러 개를 동시에 선택할 수 있다.
필터는 READY이면서 아직 제출하지 않은 Question ID로 queue를 만들 뿐 Question contract를
변형하지 않는다. 문제를 앞뒤로 이동해도 제출 전 선택·입력은 같은 Shorts session에 유지된다.

Review의 단일 기준은 `ready_question_bookmarks`다. 학생은 정답 여부와 관계없이 오른쪽 위 북마크로 문제를 저장하거나 제거할 수 있다. 오답 Attempt는 자동으로 북마크되며, 기존 오답도 migration에서 한 번 북마크로 이관한다. 북마크 옆 점은 가장 최근 Attempt가 정답이면 초록색, 오답이면 빨간색이다. 원시 Attempt는 수정하거나 삭제하지 않는다.

서술형은 정규화된 정답·허용 답안을 먼저 결정론적으로 검사한다. 여기서 확정되지 않은 답안만 AI 채점으로 보내며, 외부 호출 전에 `ready_ai_grading_requests`에 학생 응답과 당시 rubric을 저장한다. AI는 출판사 정답표를 바꾸지 않고 의미·문법·조건 충족 여부만 판정한다.

## Renderer 추가 체크

1. 실제 PDF 사례가 현재 structured payload로 표현 불가능한가?
2. canonical Passage를 수정하지 않는가?
3. raw HTML이나 제출 전 정답 노출이 없는가?
4. server deterministic grading이 가능한가?
5. append-only Attempt와 북마크 기반 Review 규칙을 지키는가?
6. mobile/desktop에서 의미가 유지되는가?

18~28 inventory는 `ready/inventory/2026-06-busan-18-28.md`를 본다.
