# READY real-PDF regression

The full gate is `npm run ready:test:full` (Node 22+; run `npm ci` first).
It runs the existing active + dormant tests, then original PDF extraction,
canonical/factory contracts and actual API/PostgreSQL/Student integration.
`npm run ready:test:pdf` runs only the private PDF gate. It FAILS if a required
source or expected artifact is missing; it never silently skips a PDF.

`npm run ready:test` remains the public CI gate and now also runs the 20-sentence
regeneration and executable Student behavior checks. **Public CI green alone is
not proof that the licensed PDF gate passed.** The original PDFs, reviewed full
text and generated expected catalogs are local fixtures, excluded from this
public repository. Set `READY_PDF_FIXTURE_DIR` to a private fixture directory to
run the full gate from another checkout/CI with authorized access. The directory
must contain the filenames from `contracts.json`, reviewed inputs, and `expected/`.

## Fixture inventory

See [SUMMARY.md](SUMMARY.md) for source names, exact stage counts, API coverage,
known limitations and artifact paths. The September file includes **21–40 in
full**, following the user's later correction. It is not restricted to 18–28.

- Four full publisher workbooks: Dong-A Lee lesson 4, MiraeN Kim lesson 3,
  Cheonjae Kang lesson 2, June 2026 grade 2 (305 pages).
- Two text-oriented documents: YBM Park lesson 4 (all five pages, including
  Further Reading), September 2026 grade 2 (all 20 passages, 21–40).
- June API excerpt: original pages 33–44 and 282–283, copied without content
  edits. The parser tests compare every copied page with the original. The
  original 11MB file must return 413 without partial writes under the existing
  upload limit; the excerpt exercises passage 21 through the real API.

## What is expected, and what is not

`contracts.json` is a small manifest of original SHA-256/page count, passage labels,
ordered bilingual meaning digests, explicit counts, representative targets,
publisher candidate counts and reviewed structure. It does not bless an entire
runtime object. A digest covers every ordered sentence pair so an omitted,
duplicated or swapped middle sentence cannot pass merely because endpoints match.

`expected/<id>.factory.json` stores normalized canonical rows, source-only Factory
items, canonical PURE items and explicit unresolved status. Text-only inputs keep
raw proposals separate from reviewed canonical/PURE results.
`expected/<id>.student.json` stores canonical rows persisted by the real API,
the compiled Studio catalog, the actual Student response and publisher candidate
counts before teacher confirmation. These are executable golden artifacts, not
illustrative documentation. Normal runs compare every item.

The projection retains block/paragraph order, question kind, prompt, answer,
hint, option groups, duplicate token multiplicity, assistance mode and source
origin. It omits UUID keys, durations, revisions, timestamps, progress and salted
verifier hashes. Option/token bank display permutations are normalized by sorting
within each group; answer order and duplicate counts remain exact. Stable keys,
fixed batch shuffles, retry and unique-cycle progress have dedicated logic tests.

PURE origins are `canonical_passage`. Publisher Factory origins are
`publisher_answer_key`; after simulated teacher confirmation Studio uses
`confirmed_annotation`. Missing publisher source is explicitly `none` for text
PDFs. A full PDF with printed exercises that cannot yet be linked is **unresolved,
not source absent**. Its zero accepted count is not a successful extraction claim.
No fallback generated authored exercises are invented to fill missing stages.

YBM's column prose needs explicit boundary review; `ybm-reviewed.json` covers
52 main-text bilingual units + 12 Further Reading units. Quoted discourse stays
with the corresponding publisher translation. September's reviewed input retains
all 21–40; the 27/28 table headings become TITLE/SUBTITLE and inline pairs are
restored from the source. Review fixtures model the existing editable review
step, not an automatic parser that has learned to recover these layouts.
Every reviewed sentence and translation must occur on its original PDF page
(ignoring layout whitespace), and counts/digests/structure remain pinned.

## Adding a regression

1. Put the licensed original PDF in this directory (or the private directory
   selected by `READY_PDF_FIXTURE_DIR`). Keep its bytes unchanged. Add its hash,
   source name, page count and selected passage labels to `contracts.json`.
2. Inspect the PDF, write expected bilingual counts/first/last/ordered digest,
   stage counts/representative answers and explicit review/unresolved cases.
   If the layout needs human review, add `<id>-reviewed.json` with `passages`
   containing `rows` (`id`, `blockType`, `paragraphIndex`, `page`, `text`,
   `translation`), and record their structure/counts/digests in the manifest.
3. Deliberately record the normalized outputs once with
   `READY_RECORD_PDF_EXPECTATIONS=1 npm run ready:test:pdf`, review the semantic
   artifact diff against the original, update the corresponding `expectedDigests`
   in `contracts.json` with the digest printed by the recording command, then run `npm run ready:test:full`
   **without** that environment variable. The recording mode does not update
   manifest expectations or bypass count/source/round-trip assertions. The
   versioned digest pins the private expected catalog while ignoring JSON whitespace.

Never resolve a failure by blindly replacing counts/digests/artifacts. Classify
whether it is a real importer/factory regression, an intentional contract change,
or a newly unsupported source. A changed PDF SHA needs source review.

## Test boundaries

- Pure Node: recall cues/IME composition helper, deterministic grading, duplicate
  token/batch logic, Enter decisions, real retry/later state transitions, stable
  canonical IDs and retained PURE payloads after editing sentence 17 of 20.
- API + PGlite: real PDF import/review/split/create/publish, source hashes,
  Student assistance/prefix verifiers, actual submissions and idempotent retries.
  Existing API tests also cover 100%/200% unique cycles, stale writes, dirty-only
  authoring and immutable learner history. Network is forbidden except the
  existing explicit AI stub; the PDF suite requires zero AI calls.
- Browser/device checks still required when changing DOM focus, layout, mobile
  keyboard continuity or native IME event ordering. Logic tests do not certify a
  physical iPhone. Existing browser harnesses remain available; this change does
  not introduce a new browser framework or claim automated physical-device QA.
