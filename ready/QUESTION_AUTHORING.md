# READY Question authoring

READY stores a Question as an independently schedulable and gradable unit. AI-assisted reference variants preserve the publisher item's tested ability and canonical evidence; they do not reproduce the source sheet.

## Source priority

1. Canonical passage: content and language facts
2. Answer/explanation: correct answer, intent, and evidence
3. Question sheet: interaction pattern, changed span, and written conditions

If those sources do not uniquely support a new answer, the item is not published.

## AI reference variant provenance

Each variant stores this private authoring block in `payload`:

```json
{
  "authoring": {
    "method": "ai_reference_variant",
    "referenceKey": "cheonjae-kang-l2-2026-predicted-1",
    "referenceQuestionNo": 8,
    "variant": "standard",
    "difficultyRubricVersion": 1
  }
}
```

`variant` is `easy`, `standard`, or `hard`, matching persisted difficulty `1`, `2`, or `3`. The reference number is shown only in the exact QA scopes `test / 1학년` and `test2 / 2학년`. Questions with this authoring method are server-hidden from every other scope even when a canonical passage is shared.

## Publication checklist

- Reuse the existing identical canonical passage; do not fork or rewrite it.
- Create one independent Question per reference and difficulty.
- Keep the reference intent, target, evidence, answer reason, and mandatory constraints.
- Write new prompts and distractors; do not copy the original sheet's numbering, layout, or full option set.
- Do not add facts absent from the canonical passage.
- Produce exactly one correct answer and run `validateQuestionSpec` plus publisher round-trip validation.
- Preserve explicit writing constraints verbatim. For reference 8 this includes temporary/progressive `be being`, non-restrictive `which`, supplied expressions with necessary inflection, and exactly 16 words.
- Publish only after all variants pass validation. Production data writes are idempotent and QA-scoped.
