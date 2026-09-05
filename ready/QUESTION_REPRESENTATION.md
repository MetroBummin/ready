# READY Question Representation

This is the active semantic contract for importing an original publisher Question. It is separate from AI Question authoring.

> A READY Question is the relationship between what the student sees, what they are asked, what the prompt points to, how they respond, and how that response is graded.

```text
Question = source_blocks + prompt + pointers + response + answer/explanation
```

PDF fonts, line breaks, coordinates, boxes, and page layout are extraction evidence, not the Question itself. The representation succeeds when a student can solve the same publisher Question with no content, condition, target, response, answer, or explanation loss.

## Five parts

### `source_blocks`

`source_blocks` contains every content block the student must read. Use as few blocks as preserve the semantic roles; do not force unrelated material into one continuous range and do not split every sentence.

- `canonical_span`: an immutable range of an existing READY Passage. Local blanks, substitutions, or annotations are declared as overlays/mutations that round-trip to the range.
- `publisher_text`: first-class problem-specific content such as a summary, Korean writing target, word bank, heavily rewritten passage, or other auxiliary text.

Multiple blocks are normal. An order Question may have `intro`, `A`, `B`, `C`; a summary Question may have `main` plus `summary`; a mixed writing Question may have the inline roles `english_before`, `korean_insert`, `english_after`.

Deterministic alignment considers token coverage, canonical coverage, edit ratio, order, and locality. A clean relationship uses `canonical_span`; a broad or ambiguous transformation uses `publisher_text`. Publisher fallback is not a failure.

### `prompt`

Preserve the publisher wording, including every visible writing condition. Do not rewrite it into READY house style. Machine-readable conditions may additionally appear in `response.constraints`; they never replace the visible prompt/condition block.

### `pointers`

A pointer identifies only what the current prompt refers to: underlines, labels, blanks, or insertion points. `span` uses an exact range. `blank` and `point` are zero-width (`start === end`). Labels do not determine roles: `(A)` can label a source block while `ⓐ` can be a target pointer.

Each pointer records `high`, `medium`, `low`, or `unresolved` confidence and extraction evidence. An unresolved pointer does not discard an otherwise complete Question; it remains a QA issue.

Pointer boundaries belong to the publisher annotation and prompt. The Answer Key supplies the answer, while canonical alignment supplies provenance and mutations; neither may widen, shrink, or replace a pointer span.

When the PDF contains underline graphics, the importer intersects those coordinates with the underlying text glyphs and treats that exact overlap as primary boundary evidence. A deterministic geometry match is `high`; text/label fallback is not promoted above `medium`; a geometry span that cannot map uniquely remains `unresolved`. A pre-existing approximate text position may select among repeated occurrences, but it never determines the final span length.

### `response`

Response types are `single_choice`, `multiple_choice`, `written_text`, and `ordering`. One publisher prompt may have several slots. Independent prompts must be separate Questions.

### `answer` and `explanation`

The publisher Answer Key is the only answer source. Link by source Question identity. Preserve the publisher explanation exactly when present; do not generate a replacement when it is absent. Private answers and explanations never appear in the pre-submit public representation.

## Hard invariants

1. No required student content is lost.
2. Prompt and visible conditions equal the publisher source.
3. Every prompt target is exact or explicitly unresolved.
4. Response mode and slots equal the publisher task.
5. Answer comes from the matching publisher Answer Key entry.
6. Explanation cannot cross a Question boundary.
7. Content from different Questions cannot be mixed.
8. No pre-submit answer leakage.
9. One READY card contains one independent prompt.
10. Every student-visible source block has one render owner and appears exactly once: passage blocks in passage order, summary in the summary surface, and word bank in the response guide.
11. `source_blocks` array order is publisher display order. Canonical offsets never sort or otherwise change that order.

Exact canonical matching and PDF layout reconstruction are not invariants. Taxonomy and renderer are compatibility metadata projected after the semantic representation is valid.

## Reusable pipeline

```text
PDF
→ Question boundary
→ canonical/body alignment
→ source_blocks
→ prompt
→ pointers
→ response
→ publisher answer/explanation linkage
→ representation validator
→ renderer compatibility projection
→ READY Question import
```

Production logic must not branch on a publisher, textbook, lesson, page, or source Question number. Calibration PDFs belong in fixtures and QA reports only.
