# Question Representation Calibration — 2026-09-05

## Scope and result

- Source: `(2022개정) 2026년 영어II 천재(강상구) 2과 예상문제 1회`
- PDF SHA-256: `e3bb6bd922912a9a8d40654080e0fb6c6ca7beb312af819c73657c289499b5ac`
- Source Questions inspected: 20
- Textbook-body Questions classified without number rules: 16 (Q3–Q18)
- Non-body exclusions: 4 (dialogue Q1–Q2, supplemental Dark Patterns Q19–Q20)
- Representation validator: 16 READY, 0 QA, 0 DROP among body Questions
- Renderer projection and publisher-answer round trip: 16/16 PASS

## Representation coverage

| Metric | Result |
|---|---:|
| `canonical_span` blocks | 20 |
| `publisher_text` blocks | 3 |
| local-mutation Questions | 9 |
| pointers | 28 |
| high-confidence pointers | 28 |
| unresolved pointers | 0 |
| single-choice Questions | 11 |
| multiple-choice Questions | 1 |
| written Questions | 4 |

The three `publisher_text` blocks are the Q6 summary frame, Q8 Korean writing target, and Q17 word bank. They are required Question content and are deliberately not forced into the canonical Passage.

## Targeted QA

| Q | Required relationship | Result |
|---:|---|---|
| 3 | intro + A/B/C blocks; order answer `(A)-(C)-(B)` | PASS |
| 4 | five pointers; answers `ⓐ`, `ⓔ`; `tells → telling`, `ban → banning` | PASS |
| 6 | canonical main + publisher summary; two zero-width blanks; `sustainable / adhere to` | PASS |
| 7 | three choice-apparatus pointers; `causing / to head / that` | PASS |
| 8 | English before/after + Korean target; `be being`, non-restrictive `which`, word-bank transformation, exactly 16 words | PASS |
| 9 | zero-width blank; `to change their behavior without realizing it` | PASS |
| 11 | two reference pointers and two independently graded Korean response slots | PASS |
| 12 | two zero-width blanks; `However / For instance` | PASS |
| 13 | two correction pointers/slots; no-word-addition condition | PASS |
| 15 | five vocabulary pointers; single publisher answer | PASS |
| 17 | canonical passage + publisher word bank; one arrangement response | PASS |
| 18 | five grammar pointers; single publisher answer | PASS |

## Safe replacement audit

Before replacement, the passage had 16 active calibration-bank Questions: 15 without an attempt and one with one historical attempt. No active-bank Question had a bookmark. The replacement was applied only after all 16 new Questions passed both validators.

- Hard deletes: 0
- Previous active Questions moved to `draft` with deprecation metadata: 16
- Historical attempt on the deprecated batch preserved: 1
- Historical bookmarks on the deprecated batch preserved: 0
- New active Questions: 16, source Q3–Q18 exactly
- Other draft experiments were left unchanged.

The passage-wide historical totals after replacement remain 15 attempts and 4 bookmarks across all generations. No other Passage was updated.
