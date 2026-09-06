# Passage Studio validation — 2026-09-06

Base: origin/main 78ee5ea. Isolated implementation branch; production data was
not migrated or published during this validation.

## Source acceptance

- September PDF named `26년 9월 고2 모의고사 21번.pdf`: four actual pages/passages,
  numbered 21–24. PDF.js extracted 9/8/8/8 bilingual rows. The first page was
  rendered and compared with the source. Korean PDF line wraps sometimes insert
  spaces within words; teachers can correct them before saving.
- 천재(강상구) 영어II 2과 Full Workbook (83 pages): 40 canonical sentence rows.
  Local acceptance split `Through Peer Pressure` into a separate SUBTITLE and
  removed the paired subtitle prefix from the sentence translation, producing
  41 structural rows / 40 Workbook sentences. 39 publisher candidate steps were
  retained after this edit. All seven Studio stages compiled and published to
  the isolated database with unresolved=0; subtitle contamination was absent.
- June Full Workbook (305 pages): explicit question/page sections were separated,
  including range labels. Some unlabeled sections and sentence pairing remain
  review-required; this file is not represented as an automatically publishable
  set. No cross-passage AI inference was used to fill those gaps.

## Executable checks

`npm run workbook:check` includes deterministic contracts, golden source gates,
real September text-fixture batch parsing, shared span interaction, and an
isolated PostgreSQL/API test. The latter runs the actual Edge handlers and SQL
migrations through a PGlite query adapter. It uses test-only password hashing and
a fixed provider response; it does not test real Gemini candidate quality or
remote Supabase transport.

The API test creates independent Drafts, confirms all four annotation types,
publishes seven stages, submits a student attempt, edits one sentence, rejects
stale publication, requests only that dirty sentence from the provider, and
republishes while asserting exact preservation of the original Attempt row and
student progress key. Concurrent stale revision/version confirmation is rejected.
Bulk confirmation rejects invalid batches atomically. Same-PDF boundary merges
retain both publisher exercise sets and page provenance; cross-PDF merges fail.
Writing reuses the existing prefix-hash verifier and full-sentence input contract.

## Browser acceptance

Local Admin and Student connected to the isolated API/PostgreSQL fixture:

- Three top-level menus, Draft/Published list states, bilingual editor and
  Authoring/Preview navigation checked.
- `If we do` → `If we do it` → `If we do`, then a separate `eating` target;
  confirmed targets persisted on reopening. Active editing has a distinct border.
- Desktop and 768px tablet inspected; no horizontal document overflow at 768px.
- Actual Student renderer opened all seven stage choices. Grammar selection
  produced immediate correct feedback, persisted the attempt, and advanced to
  the next question. Existing progress displayed 1/9 after canonical regeneration.
- This exposed a pre-existing missing `bookmarkIcon` helper in the active Student
  bundle. The helper was restored without touching the dormant Question runtime;
  the corrected bundle completed the student flow without new console errors.

- Writing browser check: `A meetingZ` retained `A meeting` and colored only `Z`
  red; correcting to `A meeting in a` immediately removed the mismatch. The
  existing input handler looked only for a blank wrapper, so its feedback host
  was extended to the existing full-sentence textarea wrapper. Verifier, answer
  normalization and grading were unchanged.

Real-provider authoring and production publication remain release QA, after the
additive migration and matching API/Admin deployment. The fixed test provider's
suggestions are structural fixtures, not teacher-approved educational content.
