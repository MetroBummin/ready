# READY repository rules

READY is a sentence-ordering practice app and nothing else. Read `README.md`
and `PRACTICE_NOTES.md` before changing it.

## Scope

- The product is two steps over canonical English/Korean sentence pairs:
  step 1 (Korean prompt, sentence audio, a wrong chip is shown and the student
  continues) and step 2 (no audio, a wrong chip restarts the sentence).
- Every word of the English sentence is a chip, articles `a`/`an`/`the`
  included. Do not add stop-word lists or drop words.
- Step-2 tolerance comes only from `LONG_SENTENCE_WORD_THRESHOLD` in
  `ready/sentence-practice.js`: sentences with that many words or more tolerate
  exactly one mistake. Do not hard-code 12 anywhere else.
- `ready/sentence-practice.js` is the single policy module for the student app,
  the Edge Function and the tests. Keep it dependency-free ESM.
- Do not reintroduce removed features (Reader, word lookup, questions, other
  Workbook stages, Review, Shorts, Studio, PDF import, AI/Gemini) without an
  explicit request.

## API and data

- `server/ready/index.ts` serves only the operations the student and admin apps
  call. When an operation is added or removed, update the client, the server
  and `tests/verify-ready-api.mjs` together; `tests/verify-ready-surface.mjs`
  checks that they agree.
- Never drop tables or add destructive migrations. Unused tables stay dormant
  and are listed in `README.md` and `PRACTICE_NOTES.md` (the surface test checks
  both lists against `supabase/migrations`).
- Attempts are append-only rows in `ready_workbook_attempts` with
  `workbook_key = 'sentence-practice'`. Never update or delete them outside the
  existing cascade RPCs.
- Sentence edits go through `ready_save_canonical_passage` so sentence ids and
  attempt history are kept.
- Secrets (service-role key, admin password, code pepper) stay in Supabase
  Edge Function secrets, never in the client, Git or logs.

## Verification

Run with Node 22: `npm test`, `npm run ready:test`, `npm run build`,
`npm run native:verify`. Tests use PGlite and must never reach the network or
production Supabase.
