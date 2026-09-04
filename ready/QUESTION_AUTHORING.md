# READY Question authoring

Read this contract before generating, importing, reviewing, or publishing any Question.

1. **Canonical passage is immutable.**
2. **Generate Questions, not replacement passages.**
3. **Difficulty changes response burden, not source truth.**
4. **One reference may create 1–3 useful variants; quantity is not a target.**
5. **Gold answer + publisher explanation + canonical passage are the quality anchors.**
6. **Explanations must cite actual textual or logical evidence.**

READY stores a Question as an independently schedulable and gradable unit. AI may create a prompt, scaffold, distractors, annotations, or a safe transformation, but it must not create a substitute reading passage.

## Source priority

1. Canonical passage: content and language facts
2. Publisher answer/explanation: correct answer, intent, and evidence
3. Question sheet: interaction pattern, changed span, and written conditions

If these sources do not prove one answer, the Question is dropped. Unsupported variants are not kept to reach a count.

## Immutable canonical source

Forbidden:

- summarizing, paraphrasing, simplifying, shortening, or merging canonical sentences;
- inventing a new example or toy sentence;
- rewriting the passage to make a Question or difficulty level easier to author;
- using `spec.passage.source = authored_variant` for an AI reference variant.

Allowed Question transformations:

- replace one exact canonical span with a blank;
- mutate one exact word or expression for a grammar or vocabulary target, with a deterministic round-trip to the canonical form;
- add annotations or response scaffolds;
- present exact canonical sentence/paragraph spans in a different order;
- create Korean or English choices and evidence-backed distractors.

Every transformed Question records the exact canonical range or source spans and its mutations. `question-authoring-quality.mjs` rejects a rewrite, a missing round-trip, or an omitted structural span.

## Difficulty variants

All variants from one reference share the same canonical source, learning target, gold answer concept, and required evidence. They may differ in:

- scaffold amount;
- choice language;
- distractor discrimination;
- evidence distance and reasoning range;
- response burden;
- number of explicit constraints.

Changing a few words, reordering choices, or paraphrasing the same task does not create new learning value. Such duplicates are removed. A Hard variant cannot be justified only by harder vocabulary.

## AI reference variant v2 provenance

```json
{
  "authoring": {
    "method": "ai_reference_variant_v2",
    "referenceKey": "cheonjae-kang-l2-2026-predicted-1",
    "referenceQuestionNo": 8,
    "variant": "standard",
    "authoringContractVersion": 2,
    "difficultyRubricVersion": 2,
    "transformation": "blank",
    "learningTarget": "...",
    "goldAnswerConcept": "...",
    "requiredEvidence": ["..."],
    "variantPurpose": "...",
    "burdenDimensions": ["response_burden"],
    "explanationAnchors": ["..."]
  }
}
```

V2 variants are visible only in the exact QA scope `test2 / 2학년`, even when their canonical Passage is also linked elsewhere. `Ref n` is public only in that QA scope.

## Explanation standard

An explanation identifies why this answer follows from this passage. It normally has the density of two or three lines, but a short item may need one or two sentences and a structural or written item may need three to five.

It must quote or name the actual English expression, pronoun reference, connective, grammar relation, numerical result, or logical transition used as evidence. Generic statements such as “문맥상 적절하다,” an answer restatement, or outside knowledge fail review.

## Quality gate before DB publication

For every candidate:

1. Reject a canonical rewrite or invented English.
2. Require proof of the answer from canonical passage plus publisher answer/explanation.
3. Require the original learning target and mandatory constraints.
4. Reject awkward grammar mutations and mutations that cannot round-trip.
5. Improve implausible distractors.
6. Reject ambiguous answer sets.
7. Remove duplicate E/S/H variants.
8. Reject Hard variants based only on difficult wording.
9. Require evidence-specific explanation anchors.
10. Keep only Questions that help the student study the source passage.

Run `validateQuestionSpec`, publisher round-trip validation, and `questionAuthoringBatchErrors` before an idempotent QA-only write.

## Reference 8 mandatory conditions

Every retained Ref 8 variant preserves temporary/progressive `be being`, non-restrictive `which`, use and necessary inflection of supplied expressions, and an exactly 16-word completed sentence. Scaffolding may reduce what the student types; it must not change the completed answer or its conditions.
