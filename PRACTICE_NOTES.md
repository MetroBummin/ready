# Sentence-ordering practice: where it came from

READY now does one thing: a student sees a Korean sentence and arranges the
full English sentence word by word, in two steps. This note records where the
two steps already existed before the reduction (commit `88c7ccd`), what was
reused, and what was rewritten.

## The two steps

| | Step 1 | Step 2 |
| --- | --- | --- |
| Prompt | Korean sentence | Korean sentence |
| Audio | "▶ 문장 듣기" plays the English sentence | none |
| Wrong chip | flashes red with a quiet note; the student keeps going | the sentence restarts from the first word |
| Long sentences | no limit on mistakes | `LONG_SENTENCE_WORD_THRESHOLD` (12) or more words: one mistake is tolerated, the second restarts |
| Recorded as clean (`correct`) | no wrong chip at all | finished without a restart |

Every word is a chip, including the articles `a`, `an`, `the`. Long sentences
show their chips in consecutive shuffled batches of up to six, but every word is
still placed.

The single policy lives in `ready/sentence-practice.js`
(`LONG_SENTENCE_WORD_THRESHOLD`, `mistakeAllowance`, `startRun`, `placeWord`,
`runIsClean`, `gradeSentenceAttempt`). The student app, the Edge Function and
the tests all import that one file.

## Where steps 1 and 2 existed before

The owner was right: both steps existed as the two modes of the Workbook
`word_order` stage (READY semantic stage 6, `kind: 'reorder_groups'`).

| Location (before) | Function / item | What it did |
| --- | --- | --- |
| `ready/workbook-order-practice.js` | `workbookOrderModeAtProblemStart`, `captureWorkbookOrderMode`, `workbookSemanticType` | Chose **practice mode** for the first two cycles (under 200 %) and **real mode** afterwards. Practice mode was step 1, real mode was step 2. |
| `ready/workbook-interaction.js` | `workbookOrderClick(…, {practice})` | Practice: a wrong chip returned `practice-wrong` and was not consumed, so the student continued. Real: a wrong chip was consumed and returned `wrong`. |
| same file | `progressiveOrderState`, `shuffleWorkbookOrderBatch`, `workbookOrderAnswerIndexes`, `workbookOrderTokenMatches` | Batches of 4–6 visible chips, duplicate words interchangeable. |
| `ready/deterministic-grading.js` | `normalizeWorkbookOrderAnswer` | Chip comparison that keeps internal punctuation (`1.5` ≠ `15`). |
| `ready/app.js` | `changeWorkbookOrder`, `flashWorkbookOrderWrongChip`, `workbookOrderGroupHtml`, `workbookOrderMode`, `retryWorkbook`, `workbookMilestoneCopy` ("200% 완료! 이제 실전 모드예요.") | UI: the built sentence, the chip bank, the red flash in practice mode, and in real mode an immediate wrong submission followed by a "지금 재시도" button. |
| `server/ready/workbook-factory.mjs` | `orderTokenParts` / `orderTokens` (tokenizer `order-tokens-v2`), `factoryOrderBank`, stage 6 in `generatePassageDeterministicCatalog` | Built one `reorder_groups` item per canonical sentence: Korean `source`, one English word per chip, articles included. |
| `ready/workbook-progress.js` + migration `20260907210000_ready_workbook_unique_cycle_progress.sql` | `clearWorkbookCycleItem`, `workbookProgressPercent`, trigger `ready_record_workbook_cycle_clear` | Cycle progress: each item counts once per cycle. |
| `ready/WORKBOOK_TYPES.md` | stage 6 `word_order` | "sentence-level, one English word per chip". |

What did **not** exist:

- **Audio / TTS.** No file and no commit in the history used `speechSynthesis`,
  `Audio`, an audio URL or a TTS service. Step-1 audio is new:
  `ready/sentence-audio.js` uses the browser's built-in Web Speech API
  (`speechSynthesis`, `en-US`). It needs no server, key or stored audio. If a
  browser or WebView has no speech support, the button is hidden.
- **Restart on a wrong chip.** Real mode marked the item wrong and offered a
  retry button; it did not restart the run in place.
- **The 12-word tolerance.** There was no length-based tolerance.
- **Choosing a step.** The mode was implied by cycle progress (under or over
  200 %); students could not pick it.

## Reused vs. rewritten

Reused unchanged (trimmed to these exports):

- `ready/workbook-interaction.js`: `workbookOrderClick`, `progressiveOrderState`,
  `shuffleWorkbookOrderBatch`, `workbookOrderAnswerIndexes`,
  `workbookOrderTokenMatches`. Both steps call `workbookOrderClick` with
  `practice: true`; the step policy then decides whether a wrong chip continues
  or restarts.
- `ready/deterministic-grading.js`: `normalizeWorkbookOrderAnswer`.
- `ready/workbook-progress.js`: `workbookProgressPercent`, `clearWorkbookCycleItem`.
- The tokenizer regex of `orderTokenParts`, copied into `sentenceWords`
  (the tokenizer version is still `order-tokens-v2`).
- The Workbook order UI classes in `ready/design.css` (`workbook-order-*`,
  `workbook-card`, `workbook-feedback`, `workbook-milestone`). Only a few
  practice rules were appended at the end of the file.
- Auth and data: student 6-digit codes (`ready_verify_student_code`), opaque
  sessions, admin password login, passages and sentences with Korean
  translations, the current school/grade scope, and the append-only
  `ready_workbook_attempts` table with its cycle-progress trigger.
- The local-first attempt queue idea from the old `app.js`
  (`queueWorkbookAttempt` / `flushWorkbookAttempts`), rewritten smaller.

Rewritten:

- `ready/sentence-practice.js` (new): step policy, tokenizer, server re-check.
- `ready/sentence-audio.js` (new): step-1 audio.
- `ready/app.js`, `ready/index.html`: login → assigned sentence sets → step 1 /
  step 2 → summary. Practice items come straight from active
  `ready_passage_sentences` rows; no Workbook catalog is needed.
- `server/ready/index.ts`: about 320 lines instead of 1 926.
- `ready/admin/*`: students, sentence sets (TAB-separated English/Korean rows),
  scope assignment, and a per-step practice summary.

## How attempts are stored

Attempts reuse `ready_workbook_attempts` without a migration:

| Column | Value |
| --- | --- |
| `workbook_key` | `sentence-practice` |
| `item_key` | `sentence:<ready_passage_sentences.id>` |
| `stage` | `1` or `2` |
| `semantic_type` (progress key) | `sentence_order_step1` / `sentence_order_step2` |
| `stage_contract_version` | `sentence-practice-v1` |
| `correct` | clean pass as defined above |
| `response` | `{ arranged, mistakes, restarts, wordCount }` |
| `stage_item_count` | number of orderable sentences in the set |

The existing trigger fills `ready_workbook_stage_progress` and
`ready_workbook_cycle_item_clears`. Older Workbook attempts keep their own
`workbook_key` and stay in the table untouched.

The client decides each tap; the server re-checks that the arrangement is the
complete canonical sentence and that the reported mistake and restart counts
are consistent with the step (`gradeSentenceAttempt`). The server cannot see
individual taps, the same trust model as the former local-first Workbook queue.

Admin edits keep sentence ids: an edited line keeps the id of the previous row
with the same English text, otherwise the id at the same position. Removed lines
become inactive rows, so history stays linked.

## API endpoints kept

`student_login`, `admin_login`, `logout`, `student_bootstrap_active`,
`student_passage`, `submit_sentence_attempts`, `teacher_bootstrap`,
`create_student`, `set_student_code`, `delete_student`, `delete_impact`,
`create_passage`, `passage_editor`, `save_passage`, `delete_passage`,
`set_scope_passages`, `admin_learning_progress`. Every other operation returns
404.

## Removed features

- Passage Reader, reader inline gloss, word lookup, saved words, word learning,
  sentence easy translation / structure, personal library.
- Question solving (multiple choice, written response), Shorts, question
  bookmarks, question sheet, question import / representation / authoring /
  difficulty pipelines and their tools.
- Every other Workbook stage (Korean/English blank, translation with AI grading,
  verb form, grammar choice, writing with hints, correction, content claims),
  Workbook bookmarks and Review, review PDF export.
- Gemini / AI calls of any kind, AI variants and AI grading.
- Passage Studio, the Workbook factory, publisher PDF import, PDF text
  extraction (`pdfjs-dist` dependency) and the code-bundled Workbook catalogs
  (`workbook-ne-l1.mjs` etc.).
- Admin: Studio, factory, content-claim bank, Workbook dashboards, attempt
  replay, scope groups / layout.
- Design previews and screenshots (`design-preview.html`,
  `word-learning-*.html`, `artifacts/`), `UI_AUDIT.md`, the dormant question
  runtime (`ready/dormant/`), inventories, fixtures, tools and their tests.

## Dormant database tables

No table was dropped and no migration was added. These tables are no longer
read or written by the app; they keep their data. The delete-cascade RPCs that
the Admin still calls also clear rows in some of them.

- `ready_questions`
- `ready_attempts`
- `ready_question_bookmarks`
- `ready_ai_grading_requests`
- `ready_word_lookup_events`
- `ready_saved_words`
- `ready_saved_word_senses`
- `ready_word_states`
- `ready_word_cache`
- `ready_saved_sentences`
- `ready_sentence_translation_view_events`
- `ready_sentence_learning_cache`
- `ready_workbook_bookmarks`
- `ready_workbook_ai_grading_requests`
- `ready_workbook_catalogs`
- `ready_workbook_factory_jobs`
- `ready_content_facts`
- `ready_content_claims`
- `ready_content_claim_variants`

Tables still in use: `ready_students`, `ready_sessions`, `ready_login_attempts`,
`ready_exams`, `ready_exam_passages`, `ready_passages`,
`ready_passage_sentences`, `ready_workbook_attempts`,
`ready_workbook_stage_progress`, `ready_workbook_cycle_item_clears`.

The lexical/bake tables created in `20260827030000` and `20260827034500` were
already dropped by `20260827060000_ready_remove_all_baking.sql` and are not
listed.
