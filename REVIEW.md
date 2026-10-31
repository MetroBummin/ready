# READY full-repo review (branch `kiro/sentence-practice-only`)

Scope: everything left after the reduction in `d49ff75`: the student app
(`ready/`), admin (`ready/admin/`), the Edge Function (`server/ready/`,
`supabase/functions/ready`), the migrations the app still depends on (RLS,
RPCs, triggers), `tools/build-pages.mjs`, tests, `.github/workflows` and the
Capacitor shell. Line numbers refer to this commit.

## Summary

The step policy is correct and has tests. Articles are chips. Step 1 never
restarts. Step 2 restarts on a mistake, and sentences with
`LONG_SENTENCE_WORD_THRESHOLD` (12) or more words tolerate exactly one mistake
per run. That constant is the only place 12 appears. The server re-checks the
arrangement and the counter consistency. Every table has RLS enabled with no
policies, and anon/authenticated have no grants. Secrets stay in Edge Function
env vars, and no keys are committed (I searched the working tree and history).

The main risk is the merge itself. `main` deploys the new Pages bundle and the
new Edge Function at the same time, and the API drops 50 of the 67 operations
the deployed clients call. That includes the installed native app, which
bundles the old web code. The review also found these problems, now fixed in
this branch:

- Student-code guessing was effectively unlimited.
- Anyone could lock the teacher out of admin login.
- Large lists were silently truncated at PostgREST's 1000-row cap.
- Saving a legacy set deleted its title rows.
- A stale admin tab could overwrite a newer edit.
- A queued attempt for a removed sentence was retried forever.
- The offline queue was lost when the session expired.

What remains is listed below.

Verification: `npm test`, `npm run ready:test`, `npm run build` and
`npm run native:verify` all pass. I also ran a headless Chrome check at
360×740 against a local PGlite API (see "Fixed in this branch").

## P0

### P0-1 Merging breaks every client already in use, and old Workbook attempts that were never sent are lost

- **Where:** `.github/workflows/pages.yml:33-59`. `deploy-pages` and `deploy-api` both depend only on `verify` and run in parallel. The ops list is in `server/ready/index.ts:20-23`.
- **Problem:** The deployed API (`88c7ccd`) serves 67 operations; this branch serves 17. Three clients are affected:
  - The Capacitor app bundles the old `dist/` (`capacitor.config.json` `webDir: dist`, no `server.url`). It calls `student_workbook`, `submit_workbook_attempts`, the Reader and the Questions ops, and all of them now return 404.
  - Open browser tabs keep running the old `app.js` until reloaded.
  - Old clients store unsent Workbook attempts under `ready-workbook-attempt-queue-v1:*`. The new server has no endpoint for them, so they can never be saved. The new client deliberately leaves those keys alone and does not send them.
  - Because the two deploy jobs run in parallel, for a short window the new Pages bundle can talk to the old API. The old API has no `submit_sentence_attempts`, `save_passage` or `set_scope_passages`. Attempts made in that window stay queued and are retried, so they are not lost. Admin saves in that window fail.
- **Why it matters:** Every installed native app stops working on the day of the merge. Students lose unsent Workbook progress without any notice.
- **Fix (owner decision; not done here):**
  1. Ship a native build from this branch before merging, or accept that installed apps break until they are updated.
  2. Before merging, drain old queues. Either keep `submit_workbook_attempts` for one release as a thin insert-only shim, or announce a cut-over time.
  3. Make `deploy-pages` depend on `deploy-api` (`needs: [verify, deploy-api]`) so the new API is live before the new UI.
  4. Tell teachers that Reader, Questions and the other Workbook stages are gone.

  Mitigation done here: unknown ops now return "지원하지 않는 READY 작업입니다. 화면을 새로고침하거나 앱을 업데이트해 주세요." (`server/ready/index.ts:28`) instead of a bare 404 message.

## P1

### P1-1 Cycle progress gets stuck, or closes early, after a set is edited

- **Where:** `supabase/migrations/20260907210000_ready_workbook_unique_cycle_progress.sql:85-91` (trigger function `ready_record_workbook_cycle_clear`).
- **Problem:** The trigger counts every clear row of the current cycle against the new `stage_item_count`, and it returns early when the clear row already exists (`v_inserted = 0`). Two cases follow:
  - **Stuck.** A student clears 2 of 3 sentences, and the admin removes the third. From then on, re-clearing either remaining sentence inserts nothing, so the cycle never closes. I reproduced this on PGlite: `currentCycleClears` 2/2, `completedCycles` 0, permanently.
  - **Early close.** Clears of removed sentences still count. If the admin removes one sentence and adds another, the cycle can close before the new sentence is ever cleared.
- **Why it matters:** Ordinary edits silently corrupt the per-step counters ("n회 완료") that students and teachers see.
- **Fix (needs a migration):** Version the function so it (a) checks for cycle completion even when the clear already existed, and (b) counts only clears whose `item_key` is `'sentence:' || id` of an active `SENTENCE` row of the passage. Alternatively, the server could pass the active key list. Add a PGlite regression test for both cases.
- **Mitigation done here:** The server no longer reports clears of inactive sentences (`server/ready/index.ts:314`). As a result, the home screen never shows more clears than sentences.

### P1-2 Step 1 has no audio in the Android app

- **Where:** `ready/sentence-audio.js:6`, `ready/app.js:151`.
- **Problem:** Android System WebView does not implement `speechSynthesis`, so `sentenceAudioSupported()` is false and the button is hidden. Chrome for Android has speech; the WebView inside the Capacitor shell does not. iOS WKWebView does support it.
- **Why it matters:** The defining part of step 1 ("듣고 배열") silently disappears for Android app users.
- **Fix:** Add a TTS plugin such as `@capacitor-community/text-to-speech`, used when `Capacitor.isNativePlatform()` and Web Speech is missing. Keep Web Speech elsewhere. This is a new native dependency, so it is not done here.

### P1-3 Student codes are a weak secret

- **Where:** `server/ready/index.ts:109-118`, `ready/admin/index.html:51` ("직접 정한 6자리").
- **Problem:** Six digits chosen by the admin give at most 10⁶ codes, and in practice far fewer (birthdays, 123456). Before this branch, the only throttle was keyed by the guessed code itself. A guesser who tried a different code each time was never limited: the PGlite run found a code after 24 tries with no 429. This branch adds a per-client limit (30 failures per 15 minutes per hashed IP). It is still beatable by rotating IPs.
- **Why it matters:** A guessed code gives a 30-day session as that student.
- **Fix:** Generate codes server-side (8+ digits, or a code plus a name or class), and alert on unusual numbers of failures. Optionally require a second factor such as choosing the student's name from a short list.

### P1-4 The student-code pepper falls back to the service-role key

- **Where:** `server/ready/index.ts:103` (same as before the reduction).
- **Problem:** If `READY_STUDENT_CODE_PEPPER` is not set in production, the fingerprint is an HMAC under the service-role (or `SUPABASE_SECRET_KEYS`) key. Rotating that key changes every fingerprint, so no student can log in until every code is reset.
- **Fix:** Check whether the secret exists in production. If it does not, set it to the value currently in effect. No code change is needed, and I did not touch production. After that, remove the fallback.

### P1-5 The admin progress summary reads every attempt in the period

- **Where:** `server/ready/index.ts:272-283`.
- **Problem:** "최근 30일" downloads one row per attempt and aggregates in the function. It is now paged, so the result is correct, but egress and latency grow with use. For example, 200 students × 100 sentences a day × 30 days is 600k rows per click.
- **Fix:** Add an aggregate RPC (migration) grouped by `student_id, stage` with `count(*)`, `count(*) filter (where correct)` and `max(created_at)`. The existing `ready_admin_learning_progress` RPC mixes all workbook keys and stages, so it does not fit.

### P1-6 The last chip of every batch is forced, and batch boundaries leak word order — **resolved**

- **Was:** chips were shown in fixed slices of six (`ready/sentence-practice.js` `visibleChips`, `ready/workbook-interaction.js` `progressiveOrderState`), so every sixth word was a forced tap that could not be a mistake, and each batch revealed which six words came next.
- **Resolution (owner decision, ClassCard-style layout):** every chip of the sentence is shown at once, shuffled once per run and reshuffled after a step-2 restart. Only the very last word of a sentence is forced. `VISIBLE_CHIP_LIMIT` is gone. Long sentences stay usable through the compact `.is-long` layout and the sticky Korean/answer head (see `PRACTICE_NOTES.md`, "Practice screen layout"). The server and the stored data are unchanged. The "documented limitation" test was replaced by "only the last word of a sentence is ever forced" and "every chip of a 16+ word sentence is visible at once" in `tests/verify-sentence-practice.mjs`.

## P2

- **`ready_save_canonical_passage` cannot see `expectedRevision`** (`server/ready/index.ts:231`). The 409 check runs just before the RPC, so two saves that land within milliseconds can both pass. Fix: add `p_expected_revision` to the RPC and check it after the `for update` lock (migration).
- **3학년 has no scope.** `ready/admin/index.html:50,76` offer 3학년, but `ready_set_current_scope_passages` accepts only 1학년/2학년 (`supabase/migrations/20260904040318_scope_passage_groups.sql:207`). A 3학년 student always sees "배정된 시험범위가 없습니다". Fix: remove the option, or widen the RPC in a migration. The school list is also duplicated in `admin/app.js:8`, `admin/index.html:49` and the RPC.
- **Client-trusted grading.** `gradeSentenceAttempt` (`ready/sentence-practice.js:116`) can only check that the counters are consistent. A student holding a token can post `mistakes: 0` for every sentence and inflate "한 번에" in the admin summary. This is acceptable for a practice app and is documented in `PRACTICE_NOTES.md`. If the summary becomes a grade, send the tap log and re-run `placeWord` on the server.
- **CORS `*`** (`server/ready/index.ts:9`). Auth uses a bearer token, not cookies, so another origin cannot act as a logged-in user. Still, restrict the allowed origins to the Pages origin plus `capacitor://localhost` and `https://localhost`.
- **Session tokens in `localStorage`, no CSP.** The student session lasts 30 days (`ready/app.js:52` always sends `remember: true`; server `index.ts:77`), with a fixed, not sliding, expiry. The admin session lasts 8 hours. All HTML is built with `esc()`, but there is no Content-Security-Policy. Add a `<meta http-equiv="Content-Security-Policy">` allowing `script-src 'self'` and `connect-src` for the API.
- **`android:allowBackup="true"`** (`android/app/src/main/AndroidManifest.xml:5`). WebView storage, including the session token, goes into device backups. Set it to `false`, or add backup rules that exclude `app_webview`.
- **Deploy is not pinned.** `npx supabase functions deploy` (`pages.yml:59`, `package.json` `deploy:api`) runs whatever CLI version is current. Pin it, for example `npx supabase@2.x.y`.
- **Bootstrap egress** (`server/ready/index.ts:337`). Home downloads the text of every sentence in every linked set only to count the orderable ones. This branch narrowed the columns, but the text is still needed. Fix: a counting RPC, or a stored count updated on save.
- **Contrast.** `--ready-muted` `#7b7b75` on `--ready-canvas` `#f6f6f3` is 3.93:1. It is used for the 11–12px step label and rule (`ready/design.css:433,1032`), which is below WCAG AA (4.5:1). Dark mode passes (5.2:1). Fix the token per `DESIGN.md`. I did not change a global token in a review.
- **The busy overlay is `aria-live="assertive"`** (`ready/index.html:38`). Every request interrupts the screen reader with "잠시만요…". Use `polite`, or announce only after about 500 ms.
- **The admin uses `prompt()` for a new code** (`ready/admin/app.js:57`). The code is visible on screen and unmasked, and there is no confirmation field.
- **Dead code that is still shipped:**
  - About 290 rule lines in `ready/design.css` (105 KB total) for Reader, Review, blanks, corrections, the stage rail and scope layout.
  - `styles/base.css` `#splash` rules plus `assets/brand/*` (5 MB). No page has a `#splash` element, yet `cp` puts these files in the native bundle.
  - `assets/favicon/old_ver/`.
  - Modal, sheet and Reader hooks in `ready/ready.css`.
  - Leftovers in `ready_save_canonical_passage`, which still sets `deterministic_status='pending'` and `ai_regeneration_required=true` on every save.
  - Dormant RPCs (`ready_publish_deterministic_catalog`, `ready_save_studio_state`, `ready_studio_create_draft`, `ready_apply_publisher_workbook_import`, `ready_import_question_*`, `ready_set_word_known`, ...).

  None of this is reachable from the app. Remove the CSS and assets in a separate change. Drop the RPCs only with a reviewed migration.
- **Test gaps.**
  - No browser test of `ready/app.js` runs in CI (queue, focus, offline). The Chrome check below was manual.
  - PGlite stubs `crypt()` with md5, so bcrypt verification is not exercised.
  - The trigger cases from P1-1 have no regression test yet.
  - Dormant-table RLS is verified only on PGlite, which has no Supabase default privileges. Run this check once in production (read-only):

    ```sql
    select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and (not relrowsecurity or has_table_privilege('anon', c.oid, 'select'));
    ```

    It should return no rows.

## Open items #74 #57 #56 #55 #7

| Item | Status | Why |
| --- | --- | --- |
| **PR #74** coalesce overlapping `student_workbook` reads | **Obsolete** as written | `student_workbook`, prefetch and the Workbook catalog no longer exist, so there are no overlapping reads to coalesce. Each `student_passage` call is explicit and small. Its underlying goal, egress, still applies to two different places: the bootstrap sentence download (P2) and the admin summary scan (P1-5). Close the PR and track those two instead. |
| **Issue #57** attempt retry idempotency | **Mostly resolved** | The AI grading, bookmark and Review side effects are gone. Grading is deterministic. `clientAttemptId` is now required, and the unique index means the progress trigger fires once. This branch also looks up already-stored attempts before re-checking access or re-grading, so a retry gets back the stored `correct` even after the scope or the sentence changed (`server/ready/index.ts:375-411`; tested in `tests/verify-ready-api.mjs`). Remaining gap: the retry response carries current progress, not the progress at first save, which is harmless for this UI. The issue can be closed once the tests are reviewed. |
| **Issue #56** canonical concurrent edit lost-update | **Partially resolved** | The admin now sends `expectedRevision`, and the server returns 409 with "다른 곳에서 이 문장 세트가 수정되었습니다…" (test: two editors start from the same revision, and the first save survives). The check happens just before the RPC, so a race of a few milliseconds remains until the RPC takes `p_expected_revision` (migration; P2). |
| **Issue #55** catalog change vs grading/progress continuity | **Still relevant**, in a smaller form | The "catalog" is now the active sentence list. Attempts record `passage_revision`. Grading uses the sentence's current text, so a queued attempt for a sentence whose text was edited is rejected after the client already showed it as done. The new client drops it rather than retrying forever, but the student's step is not recorded. Cycle continuity is broken after edits (P1-1). Policy still to decide: whether a heavily edited sentence that keeps its id (matched by position in `ready/admin/sentence-rows.js`) should keep its clear. Recommendation: keep clears by id, grade a queued attempt against the revision it carries when that text is still known, and fix the trigger as in P1-1. |
| **PR #7** difficulty-aware AI question variants | **Obsolete** | Questions, AI variants, the source/difficulty filters and Gemini were removed, and `ready_questions` is dormant. The 48 QA variants written to production remain as dormant rows. Edge Function v174's compatibility code is replaced by this branch's function on merge. Close it without merging. |

## Fixed in this branch

All of the following are covered by `npm test` unless noted.

**Server (`server/ready/index.ts`)**

- **Login throttling per client.** Each failure is also recorded under a peppered hash of the client IP (`clientKey`). Students get 30 failures per 15 minutes per client. Admin gets 5 per client plus 50 globally, so bad guesses from one client no longer lock out the teacher. Test: 32 different wrong codes are throttled, another client still logs in, and the admin still logs in from a different client.
- **5xx responses no longer carry raw database messages** (table and constraint names). They are logged, and the client gets a generic message. Tested.
- **Paged reads past PostgREST's silent `max-rows` cap** (`allRows`, which pages until the exact count is reached) for students, sets, scope links, sentences, progress, clears and the admin summary. The test helper now emulates the cap (`globalThis.__readyMaxRows`), and the test lowers it to 2.
- **Concurrent edits:** `save_passage` takes `expectedRevision` and returns 409 on a stale save. The admin sends the revision it loaded.
- **`save_passage` keeps legacy structure.** TITLE/SUBTITLE rows and paragraph indexes, which the sentence-only editor never shows, used to be deactivated on every save. They are now re-inserted in place (`mergePassageStructure`). Tested.
- **Batch submit:**
  - Access and sentences are loaded once per set, and progress once per set after the inserts (previously N+1 per attempt).
  - Already-stored attempts are replayed first, and the stored `correct` is returned.
  - 4xx outcomes, such as a removed sentence or a set taken off the scope, come back as `rejected`, so the client drops them instead of retrying forever.
  - `clientAttemptId` is required.
- **Progress excludes clears of inactive sentences.**
- **The "오늘" (today) period starts at 00:00 KST, not 00:00 UTC.** The 7d and 30d periods are also anchored to KST midnight. Tested with fixed instants.
- **`last_seen_at` is written at most every 5 minutes**, instead of one extra write per request.
- **Malformed JSON returns 400, not 500.** Removed ops get a "새로고침/업데이트" message, and 4xx responses are no longer logged as errors.
- **Removed the unused `validPin` export** (`server/ready/auth-core.mjs`).

**Student app (`ready/app.js`, `ready/api.js`, `ready/index.html`, `ready/design.css`)**

- **Attempt queue:**
  - The queue is keyed by student id instead of a token suffix, so attempts survive session expiry and re-login. The old key is merged once.
  - It backs off exponentially up to 60 seconds and retries on `online`.
  - On a 401 it keeps the queue and asks the student to log in again.
  - Empty queues remove their storage key.
- **30-second request timeout** (`ready/api.js`), so a stalled connection cannot hold the queue forever. Checked with a mock fetch.
- **`attemptId()` fallback** for WebViews without `crypto.randomUUID`. Unit-tested.
- **Offline:** a failed bootstrap shows a "다시 시도" screen instead of dropping the student to the code form. A set already opened in the session can be practised offline.
- **Accessibility:**
  - Focus returns to the same chip after each tap, to the first chip of the next sentence, and to the set after leaving.
  - Feedback and completion are announced through one polite live region (`#practice-live`) instead of re-inserted `role=status` nodes.
  - The built sentence has `role="group"` for its label.
- **Double-tap guard:** for 280 ms after a batch changes or the sentence restarts, taps are ignored, so a fast second tap on a chip that just appeared is not counted as a mistake. (Batches are gone since P1-6 was resolved; the guard now covers restarts, the start of ordering, and a same-spot second tap after a placement.)
- **Legacy caches** of the removed Reader/Workbook client (`ready-workbook-cache-v3:` and others) are deleted at start-up to free storage. The old unsent attempt queue is kept.
- **Audio stops when the page is hidden.**
- **At 360px, the step label and the step-2 rule overlapped the "n / m" counter.** They are now stacked (`.practice-step-meta`).

**Audio (`ready/sentence-audio.js`):** The voice picker skips Apple novelty voices (Albert, Bad News, Zarvox, …) and prefers the system default or a natural en-US voice. Unit-tested.

**Admin (`ready/admin/*`)**

- Sends `expectedRevision`.
- Editor lines flatten stored line breaks and TABs, so one sentence stays on one line and still matches its id (`editorLine`). Unit-tested.
- Saving a set or a scope no longer re-downloads the attempt summary.

**Headless Chrome check at 360×740, local PGlite API, built `dist/`** (manual, not in CI):

- No horizontal overflow on home or practice, including words of 20+ letters.
- Chips are at least 46 px high and 41 px wide. Step buttons are 51 px high.
- Step 2 shows no audio button; step 1 shows it.
- A wrong chip in a short step-2 sentence restarts it and is announced.
- Completion moves focus to "다음 문장".
- A fast wrong tap right after a batch change is ignored.
- The queue key is removed after a flush, and legacy cache keys are removed on load.
