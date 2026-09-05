# READY Question difficulty

> **Status: DORMANT — preserved for future use.** Difficulty data and rules remain valid for stored Questions, but active READY does not expose Question filtering or badges.

`ready_questions.difficulty` is the single persisted difficulty value used by Student Question filtering and badges.

| Value | Label | Authoring rubric |
| --- | --- | --- |
| `1` | Easy | One direct fact, explicit vocabulary/grammar cue, or a short local inference. |
| `2` | Standard | Connects two nearby facts, distinguishes plausible distractors, or applies one learned language rule. |
| `3` | Hard | Integrates a wider span, resolves discourse/grammar structure, or satisfies multiple written conditions. |

## Rules

- Difficulty describes the work required by the Question, not the passage's general level.
- Difficulty changes the burden of answering, not the truth being studied.
- Never raise difficulty by summarizing, paraphrasing, simplifying, or making the canonical passage harder. The canonical source is the material the student must actually study.
- Difficulty is evaluated through evidence distance, distractor discrimination, language burden of the prompt/choices, response burden, and reasoning/constraint burden.
- Variants from one reference retain the same canonical passage, learning target, gold answer concept, and evidence.
- Every `available` Question must have exactly one value: `1`, `2`, or `3`.
- Draft/drop Questions may remain unclassified because they are not student-visible.
- The Student UI always shows `Easy`, `Standard`, or `Hard`; it never derives difficulty from provider, taxonomy, or answer history.
- Filtering composes difficulty with zero or more taxonomies. Counts must be recomputed for the current combination.
- Existing available Questions are backfilled once with the version 1 rubric. Future authoring assigns difficulty before publication.

## Backfill rubric version 1

- Hard: paragraph order, sentence insertion, multi-error grammar, implication, two-blank summary, and written responses with at least 12 required words or at least three response slots.
- Easy: direct Korean-choice fact checks (`content_true`, `content_false`, `unanswerable`, `main_idea`, `topic`, `title`) when the choices make the evidence explicitly local.
- Standard: all remaining available Questions, including A/B grammar selection and short guided writing.

The migration only fills `difficulty is null`; it never overwrites a reviewed value.
