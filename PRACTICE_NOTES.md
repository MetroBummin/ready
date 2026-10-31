# Sentence-ordering practice: where it came from

READY now does one thing: a student sees a Korean sentence and arranges the
full English sentence word by word, in two steps. This note records where the
two steps already existed before the reduction (commit `88c7ccd`), what was
reused, and what was rewritten.

## The two steps

| | Step 1 | Step 2 |
| --- | --- | --- |
| Before ordering | preview card: the English sentence, the speaker, and the Korean behind a tap-to-reveal bar | none: ordering starts at once, the English is never shown first |
| Prompt while ordering | Korean sentence | Korean sentence |
| Audio | speaker icon plays the English sentence (optional auto-play) | none |
| Wrong chip | flashes red with a quiet note and is not placed; the student keeps going | the sentence restarts from the first word, chips reshuffled |
| Long sentences | no limit on mistakes | `LONG_SENTENCE_WORD_THRESHOLD` (12) or more words: one mistake is tolerated, the second restarts |
| Recorded as clean (`correct`) | no wrong chip at all | finished without a restart |

Every word is a chip, including the articles `a`, `an`, `the`. All chips of
the sentence are shown at once, shuffled once per run (a step-2 restart
reshuffles). Placed chips leave the bank and the rest reflow. Duplicate words
stay interchangeable.

The single policy lives in `ready/sentence-practice.js`
(`LONG_SENTENCE_WORD_THRESHOLD`, `mistakeAllowance`, `stepShowsPreview`,
`isLongSentence`, `startRun`, `placeWord`, `visibleChips`, `runIsClean`,
`gradeSentenceAttempt`). The student app, the Edge Function and
the tests all import that one file.

## Practice screen layout

The screen follows the two ClassCard-style references (preview card and
ordering) in READY's own tokens: white `--ready-surface` page with no card
around the content, `--ready-ink` text, `--ready-hairline` rules and chip
edges, `--ready-action` for the swipe hint, `--ready-success` / `--ready-error`
for state. Dark mode uses the same tokens. The HTML is built by
`ready/practice-view.js` (pure functions, tested in Node); `ready/app.js` owns
state, events and focus; the CSS is the last section of `ready/design.css`.

- **Top bar:** back chevron, a pill counter `n / total` (n = sentences finished
  in this run, so a set starts at `0 / 10`), a star and a settings icon. Every
  control is a 44 px target.
- **Step-1 preview:** the English sentence (26 px bold), then a gray bar that
  reveals the Korean in place when tapped, then "« 밀어서 영작연습" at the
  bottom. A left swipe of 60 px or more anywhere on the screen (pointer
  events; vertical scrolling still works through `touch-action: pan-y`), a tap
  on the hint, or Enter / → starts ordering. A swipe that ends on a button
  does not also press it.
- **Ordering:** speaker (step 1 only) and the step label, the Korean prompt in
  small gray text, the answer, a feedback line, then the chips (white, 2 px
  hairline border, bold 20 px).
- **Sticky head:** the top bar, the Korean prompt and the answer form one
  `position: sticky` block, so they stay in view while only the chips scroll
  under them on a long sentence or a short screen. (`body` gets
  `overflow-x: clip` on this screen: with the global `overflow-x: hidden`,
  `body` became a scroll container and the sticky head scrolled away.)
- **Answer lines:** placed words flow as text on ruled lines drawn by a
  repeating background. The area starts as one empty line and grows only when
  the words wrap; no empty lines are drawn ahead.
- **Long sentences:** at `isLongSentence(words)` (the same 12-word threshold)
  the screen gets `.is-long`: answer 18 px on 38 px lines, chips 17 px with
  tighter padding and gaps. Checked in headless Chrome: a 22-word answer takes
  4 lines at 390 px and 5 at 360 px; 17 words take 2-3 lines. No horizontal
  overflow at 360 px.
- **Completion:** the answer shows the canonical sentence, punctuation
  included, in `--ready-success`, a "✓ 완성했어요." line (plus the mistake or
  restart count when not clean), and a "다음 문장" / "결과 보기" button at the
  bottom. Focus moves to it, and Enter goes on.
- **Star:** a per-sentence mark stored only on this device, in
  `localStorage['ready-practice-bookmarks-v1:student:<student id>']` as a list
  of `sentence:<id>` keys. No server call or table. `aria-pressed` follows it.
- **Settings:** a small panel with a dark-mode switch and, in step 1 when
  speech is available, "자동 재생" (play the sentence when each preview card
  opens; `localStorage['ready-practice-autoplay']`). Escape or a tap outside
  closes it. The home screen keeps its own theme button.
- **Accessibility kept from `0eb25f3`:** one polite live region announces the
  prompt, mistakes, restarts and completion; focus returns to the same control
  after each re-render (for a chip: the chip now at the same position, since
  placed chips leave the bank); the tap guard ignores taps for 280 ms after a
  restart reshuffles the chips or after ordering starts, and ignores a second
  tap on the same spot within 280 ms of a correct placement (the next chip has
  just slid under the finger).

### Decisions

- **All chips at once (resolves REVIEW P1-6).** With batches of six, every
  sixth word was a forced, mistake-free tap and the batch told the student
  which six words came next. Now only the last word of a sentence is forced.
  All-chips stayed workable for long sentences: 22 chips fit in about six rows
  at 360 px with the long-sentence sizes, and the sticky head keeps the
  Korean and the answer in view while the chips scroll.
- **Placed chips leave the bank** instead of leaving empty placeholders. The
  answer line shows what was placed, and a shrinking bank is easier to scan
  than one with holes. The cost, a chip sliding under the finger, is covered
  by the same-spot double-tap guard.
- **Step 2 has no preview** and the English text is not in the page until the
  sentence is finished, so it cannot be read before ordering.

## Where steps 1 and 2 existed before

The owner was right: both steps existed as the two modes of the Workbook
`word_order` stage (READY semantic stage 6, `kind: 'reorder_groups'`).

| Location (before) | Function / item | What it did |
| --- | --- | --- |
| `ready/workbook-order-practice.js` | `workbookOrderModeAtProblemStart`, `captureWorkbookOrderMode`, `workbookSemanticType` | Chose **practice mode** for the first two cycles (under 200 %) and **real mode** afterwards. Practice mode was step 1, real mode was step 2. |
| `ready/workbook-interaction.js` | `workbookOrderClick(…, {practice})` | Practice: a wrong chip returned `practice-wrong` and was not consumed, so the student continued. Real: a wrong chip was consumed and returned `wrong`. |
| same file | `progressiveOrderState`, `shuffleWorkbookOrderBatch`, `workbookOrderAnswerIndexes`, `workbookOrderTokenMatches` | Batches of 4–6 visible chips, duplicate words interchangeable. (Sentence practice now shows every chip; only the next-expected logic is still used.) |
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
- The Workbook milestone classes in `ready/design.css` (`workbook-milestone`)
  for the summary screen. The practice screen has its own `practice-*` rules at
  the end of the file; the old `workbook-order-*` rules are no longer used by
  the student app.
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
