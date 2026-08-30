# READY Stabilization Audit — 2026-08-27

READY is now constrained to one product path: authenticated Students read the
Passages assigned to their fixed school/grade Scope; the administrator manages
Students, the Passage Library, Scope membership, deterministic study memory,
and deletion.

## Runtime classification

### ACTIVE

- `ready_students`, bcrypt PINs, opaque `ready_sessions`, login throttling
- eight permanent school/grade rows in `ready_exams` and `ready_exam_passages`
- `ready_passages`, `ready_passage_sentences`, and one atomic structured-row write
- on-demand Gemini contextual dictionary lookup and simple `ready_saved_words`
- student lookup/view events and deduplicated saved word/sentence records
- atomic Student and Passage delete-impact/cascade RPCs
- 18 statically visible frontend operations, two typed-modal delete operations,
  and authenticated server-only `create_passage` (21 Edge operations total)

### PRESERVED DORMANT

- `ready_questions` and `ready_attempts`: retained so historical data and the
  generic future Question/Attempt shape are not destroyed. They have no current
  UI, Edge dispatch operation, or bootstrap query.
- Question/Attempt cleanup remains inside Passage/Student deletion transactions
  so dormant rows cannot become orphans.

### LEGACY IN PRODUCTION ONLY

- `ready_study_sets`, `ready_publications`, and `ready_publication_questions`
  remain in the existing production database (one StudySet, one Publication,
  zero links at audit time). Clean migrations do not create them and current
  code never reads or writes them. Passage deletion retains guarded cleanup for
  these old links until the production rows can be removed deliberately.
- legacy Passage/Exam compatibility columns remain in production. Scope
  membership is sourced only from `ready_exam_passages`.

### REMOVED DEAD / DUPLICATED

- ORDER generator/editor/player, question status mutation, attempt submission,
  and Admin Analytics runtime
- admin bootstrap queries for Question, Attempt, saved-memory, lookup, and view
  datasets that no visible screen consumed (11 query groups reduced to 5)
- READY TSV parser, paste Import form, Import Preview state/modal, and related CSS
- obsolete passage/student drag, question/player/analytics/memory CSS
- every sentence/lexical bake table, status column, RPC, retry, UI, prompt, and
  Anthropic/OpenAI provider path; saved lexical data was copied to SavedWord
  before the old tables were dropped
- phrase/concept/sense-key remap machinery and persisted Reader tokens

## API and performance contract

- Mutations execute once; only explicitly read-only operations may retry once
  after a transport failure.
- `teacher_bootstrap` loads Students, current Scopes, Passages, and Scope links
  in four parallel queries. It no longer downloads every sentence and
  translation just to open the Passage Library.
- Student creation calls one bcrypt RPC; the retired drag-order lookup is gone.
- Passage creation calls one atomic RPC and returns its `passageId`; it does not
  re-fetch the newly written Passage and all sentences.
- Reader opens from a local revision cache immediately, then revalidates.
- Word taps make one authenticated, on-demand Gemini contextual dictionary request and write one lookup event. The old lemma-only cache is deliberately bypassed because it cannot preserve sentence context.
  Sentence translation views render from teacher data and send one background event.
- Save operations are optimistic, idempotent in the database, and invalidate the
  in-memory Review list.
- `create_passage` is an admin-session-only structured-data ingress retained for
  ChatGPT Work tooling. It accepts explicit `sentenceRows` and calls one atomic
  database RPC; READY contains no file/paste Import workflow.

## Migration verification

- Local and remote migration ledgers match for all twelve migrations.
- Linked dry-run reports no pending migration.
- Remote PostgreSQL lint reports no schema error.
- Static clean-schema contracts verify that the first migration creates the
  complete current core and that StudySet/Publication are absent.
- A fresh disposable database execution was not available on this machine
  because no Docker/PostgreSQL runtime is installed. Production was not reset or
  repurposed for this check.

## Database audit

- Active tables: Students/sessions/login attempts, eight internal current Scope
  rows and their Passage links, Passages/Sentences, SavedWord/SavedSentence,
  lookup/view events, and the legacy dictionary cache (retained but no longer
  used by contextual lookup).
- Dormant tables: Question/Attempt are kept for historical ORDER compatibility.
  Production-only StudySet/Publication tables contain legacy records and remain
  isolated from runtime. The empty production-only textbook-group table is also
  left untouched because it is outside reproducible migration history.
- Active RPCs in migration history: student create/PIN verify/PIN reset, atomic
  Passage creation, atomic Scope membership, and atomic Student/Passage deletion.
  Dynamic Exam creation/deletion and bake RPCs are dropped by later migrations.
- The production-only `ready_passages_exam_position_idx` served the retired
  direct Passage→Exam path. Migration `20260827070000` removes only that index;
  its compatibility columns and data remain intact.

## Size and request delta for this pass

- Active runtime source (`ready/admin/app.js`, `ready/ready.css`, and
  `server/ready/index.ts`) decreased by 2,352 bytes. Contract tests grew by 568
  bytes to pin the smaller payload and write behavior; net repository delta is
  still a reduction before the audit documentation and migration.
- Dead READY CSS removed: StudySet grid/button, pill/gate/inline form, old
  Passage card/header, retired drag-layout helpers, and unused success styling.
- Admin bootstrap: 5 → 4 database queries and 145 Sentence rows removed from the
  current production payload.
- Student creation: 2 → 1 database operations.
- Passage creation: 3 → 1 database operations.
- Reader open and study interactions retain the existing authenticated access
  checks. They are query-heavy but were not replaced with a new RPC/cache layer
  during this deletion-focused pass; see technical debt below.

## Remaining technical debt

1. An authenticated Reader open still performs session validation/touch,
   Student lookup, Scope/link validation, Passage lookup, and three data reads.
   Combining those safely would require a carefully tested DB contract.
2. Word/sentence interactions repeat Scope/link validation. This is intentional
   authorization today, but the cost should be measured with real student load.
3. Historical applied bake migrations create then remove obsolete objects on a
   clean install. Squashing them would rewrite migration history, so it is
   deferred until a new READY database generation is planned.
4. Production-only StudySet/Publication/textbook-group objects are not described
   by the clean migration chain. They should be removed only after their exact
   records are deliberately retired.
5. `sort_order`, direct Passage `exam_id`/`position`, and old processing metadata
   may remain as dormant production columns even though current runtime no
   longer selects them.
