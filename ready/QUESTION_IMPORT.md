# READY Question Import Workflow

새 bundle은 명시적인 render spec을 반드시 포함한다. importer는 누락되거나 서로 모순되는 명세를 기본적으로 거부한다. `--allow-legacy`는 이미 검수된 과거 bundle에만 사용하고 새 PDF에는 사용하지 않는다.

```json
{
  "status": "available",
  "payload": {
    "taxonomy": "grammar_multi_error",
    "import_status": "ready",
    "spec": {
      "renderer": "annotated_passage_mcq",
      "passage": { "source": "canonical", "annotations": [] },
      "choiceMode": "multi",
      "responseMode": "choice",
      "gradingMode": "exact_set"
    }
  }
}
```

깨끗한 본문 출처나 정확한 target을 확정할 수 없으면 `DROP`으로 기록하고 import bundle에서 제거한다. 공개한 뒤 프런트엔드에서 PDF 장치를 지우는 방식은 허용하지 않는다.

이 문서는 PDF를 private structured Question bundle로 바꾸고 READY에 원자적으로 반영하는 절차다. 콘텐츠 추출은 teacher-side에서 수행하며 READY 학생/Admin UI에 PDF parser나 AI pipeline을 넣지 않는다.

## Required flow

```text
PDF
→ source exam / Section / source question number 확인
→ source passage number 확인
→ READY canonical Passage ID 연결
→ Question family 분류
→ canonical / variant 결정
→ prompt / choices 또는 response slots 추출
→ 뒤쪽 정답·해설과 대조
→ private JSON bundle dry-run
→ atomic import
→ student solve / Attempt / Review E2E
```

명시적 시험·지문 번호를 identity로 사용한다. 텍스트 similarity는 연결 후 검증용일 뿐이며 fuzzy/AI matching을 우선하지 않는다.

## Private bundle

문제 본문, 보기, 정답이 포함된 bundle은 공개 저장소에 커밋하지 않는다. 저장소에는 contract와 source-number inventory만 둔다.

각 row:

```json
{
  "passage_id": "canonical READY Passage UUID",
  "type": "multiple_choice",
  "status": "available",
  "payload": {
    "family": "annotated",
    "skill": "grammar",
    "prompt": "...",
    "choices": ["..."],
    "answer": [2],
    "multi_select": false,
    "variant_segments": [],
    "position": 11,
    "source": {
      "provider": "exam4you",
      "exam": "2026-06 부산 고2 예상문제",
      "passage_no": 20,
      "source_question_no": 11,
      "section": "1"
    },
    "source_kind": "textbook_main"
  }
}
```

`passage_id + exam + passage_no + source_question_no + section`이 import identity다. 같은 identity를 다시 import하면 새 Question을 중복 생성하지 않고 기존 row를 갱신한다.

`source.provider`는 `exam4you` 또는 `nernter` 중 하나를 import 시점에 반드시 명시한다. 이 값은 문제의 의미·렌더링·채점에 관여하지 않고 학생 Shorts queue를 만드는 필터 metadata로만 사용한다. 기존 운영 문제는 모두 `exam4you`, 너른터 PDF에서 새로 통과한 문제는 `nernter`다.

학생 풀이와 출제의 최소 단위는 언제나 개별 Question이다. `source.set_id`는 같은 PDF 묶음에서 왔다는 출처 추적값일 뿐, 화면 묶음·풀이 순서·상태 공유의 기준으로 사용하지 않는다. 각 Question은 같은 canonical Passage를 참조할 수 있지만, 학생 화면에는 현재 Question의 `set_text` 또는 최소 장치만 적용한다. 따라서 다른 Question의 빈칸, ⓐ~ⓔ, (A)~(E)가 현재 지문에 섞여서는 안 된다.

## Validation

1. canonical Passage ID가 명시적 `source.passage_no`와 맞는지 확인한다.
2. prompt와 모든 choice를 문제 쪽과 대조한다.
3. `answer` 또는 `accepted_answers`를 정답/해설 쪽과 대조한다.
4. single/multi를 문제 지시문과 대조한다.
5. canonical 문제는 variant를 넣지 않는다.
6. 원문에 문제 장치만 올리는 경우는 `variant_mode: "canonical_overlay"`, 출제자가
   내용을 요약·바꿔 쓰거나 다른 단어로 표현한 지문은 `variant_mode: "authored_variant"`로
   명시한다. 후자는 canonical 복원 대상이 아니다.
7. 문제용 변형은 `variant_text`, `variant_segments`, `content_blocks` 중 최소 표현을 사용한다.
8. raw HTML을 payload에 넣지 않는다.
9. Passage 25 chart처럼 외부 asset이 없으면 `draft`로 유지한다.
10. public response에 `answer`/`accepted_answers`가 없는지 contract test로 확인한다.
11. 교과서 bundle은 본문 일치 검증 후 `source_kind`를 넣고, 대화문과 본문 외
    자료는 각각 `dialogue`, `supplemental`로 보존하되 학생 풀이에서 제외한다.

Dry-run:

```bash
npm run ready:import -- /absolute/path/to/private-bundle.json
```

Apply에는 runtime 환경변수가 필요하다. 값은 명령행, JSON, Git, 로그에 넣지 않는다.

```bash
READY_API_URL=... READY_ADMIN_PASSWORD=... \
  npm run ready:import -- /absolute/path/to/private-bundle.json --apply
```

서술형은 기존 자료까지 import 전에 동일한 AI 구조화 관문을 거친다. 정답과 정답별
단어 수는 같은 PDF의 출판사 정답표에서 결정론적으로 추출하고, AI는 정답을 만들거나
바꾸지 않는다.

정답에서 역산한 답칸별 단어 수는 validator와 AI 채점기에만 남기는 private metadata다.
PDF 문제의 조건에 단어 수가 명시된 경우에만 `writing_guide.conditions`로 학생에게
보여 준다. public Question의 답칸 placeholder로 정답 단어 수를 노출하지 않는다.

```bash
npm run structure:written -- \
  --input /absolute/path/to/private-bundle.json \
  --output /absolute/path/to/structured-bundle.json
```

이 단계는 로그인된 Codex CLI로 원문, 우리말 목표문장, 조건, 보기, 연속 포인팅 범위,
요약문, 답 칸을 분리한다. 이어서 코드는 원문 포함 여부, 답 칸 수, 각 정답의 실제
단어 수를 다시 검사한다. 신뢰도 0.85 미만이거나 한 항목이라도 어긋나면
`DROP` 사유가 보고서에 남고 문제 자체는 import bundle에서 제외된다. AI는 비공개 정답을
수정하지 않으며 정답에서는 검증에 필요한 칸 수와 단어 수만 사용한다.

`ready:import`는 서술형이 들어 있는 새 bundle에 `ai_written_structure` 검수 기록이
없으면 import 자체를 거부한다. 즉 사람이 중간 단계를 빠뜨려도 미검수 서술형이
공개될 수 없다.

## Block-first PASS/DROP pipeline

가져오기는 완성된 문자열에서 불필요한 것을 지우지 않는다. PDF를 `passage`,
`prompt`, `korean_target`, `condition`, `word_bank`, `choice`, `summary`,
`answer_template`, `annotation_source`, `explanation`, `stimulus` source block으로
먼저 나눈 뒤 renderer별 whitelist에 있는 block만 학생 명세에 넣는다.

모든 문제는 PDF SHA-256, 문제 identity, page, bbox provenance를 가진다. provenance는
import/debug 전용이며 학생 renderer가 원문 PDF를 다시 읽거나 위치 정보에 의존하지
않는다. 승인된 passage block과 학생에게 표시되는 passage가 정확히 같지 않거나,
prompt·요약·한글 목표문·조건이 passage에 섞였거나, annotation이 `turned off` 같은
정확한 연속 문자열을 가리키지 않으면 즉시 `DROP`한다. 전체 canonical Passage로
대체하는 fallback은 금지한다.

포인팅은 문법적 기능을 이루는 고정 표현 전체를 포함해야 한다. 예를 들어 원문이
`In order to`인데 `In`만 annotation으로 선언되면 span closure 검사에서 `DROP`한다.
또한 현재 문제의 interaction으로 활성화되지 않은 `(A)[x / y]` 장치가 passage에
남아 있거나, 내용 일치·불일치 선택지의 핵심 근거 어휘가 승인된 passage 범위에
전혀 없으면 풀이 범위가 불완전한 것으로 보고 공개하지 않는다.

학생용 원문과 annotation label은 NFC로 보존한다. NFKC는 정답 비교·검색처럼
호환 문자 차이를 지워야 하는 비공개 비교 경로에서만 사용한다. 원문에 NFKC를
적용해 `ⓐ`를 `a`로 바꾸는 것은 import 실패다. 일반 내용·주제·제목 문제는 현재
문제에 활성 annotation이 없으므로 다른 문제의 `ⓐ` 또는 `(A)[x / y]` 장치가 하나라도
남으면 `DROP`한다.

서술형은 서로 다른 유형을 대표하는 7개 fixture가 최종 렌더 계약까지 모두 통과한
뒤에만 전체를 한 번 처리한다. AI는 PDF block 경계만 구조화하고 정답은 출판사
정답표를 source of truth로 유지한다. 코드는 답칸 수, 정답 수, 실제 단어 수,
필수 우리말·조건·보기와 연속 annotation을 다시 검증한다.

객관식은 먼저 deterministic extraction과 같은 strict validator를 통과시킨다.
통과한 문제는 AI에 보내지 않는다. 탈락 문제만 AI block/span 구조화를 정확히 한 번
거친 뒤 같은 validator에 넣으며 재시도하지 않는다. validator를 느슨하게 하거나
개별 문제 예외를 추가해 AI 결과를 살리는 것은 금지한다.

서버는 admin session을 만든 뒤 `ready_import_question_bundle` RPC 하나로 bundle 전체를 transaction 처리한다. 한 row라도 검증에 실패하면 전체 import가 rollback된다.

## E2E acceptance

1. Passage 목록의 Question count가 import 수와 일치한다.
2. standard, annotated, structural, summary, written 대표 문제를 mobile/desktop에서 푼다.
3. 제출 전 network payload에 정답이 없다.
4. 제출 후 `ready_attempts`에 새 row가 하나 추가된다.
5. 일부러 오답 제출 → `복습 문제` count 증가 → 복습에서 재풀이 → 정답 제출 → queue에서 제거를 확인한다.
6. generated fixture 1~2개도 같은 import RPC와 renderer를 사용한다. `ready/fixtures/generated-question-smoke.json`은 contract 예시이며 실제 Passage ID로 바꾸기 전에는 import하지 않는다.

## 18~28 status

- 조사: 137문항 완료.
- contract 표현 가능: 137문항.
- private asset 없이 import 가능: 136문항.
- Passage 25 source question 32는 라이선스가 보존된 graph asset 또는 structured chart representation이 필요하다.
- 상세 inventory: `ready/inventory/2026-06-busan-18-28.md`.
