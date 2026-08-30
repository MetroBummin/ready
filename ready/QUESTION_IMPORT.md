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

깨끗한 본문 출처나 정확한 target을 확정할 수 없으면 `status=draft`, `import_status=needs_review`로 저장한다. 공개한 뒤 프런트엔드에서 PDF 장치를 지우는 방식은 허용하지 않는다.

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
