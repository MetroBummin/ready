# READY Question subsystem — dormant

**Status: DORMANT — preserved for future use.**

READY currently ships Passage, Workbook, Review, and Workbook learning progress as its active learning surface. Question is intentionally absent from normal Student and Admin flows so Workbook can evolve without sharing UI state, styles, requests, or release risk with Question.

Dormant does not mean deleted or deprecated. Historical data, server contracts, importers, graders, migrations, authoring rules, and regression tests remain source-controlled and valid.

## Boundary

| Area | Active READY | Dormant Question |
| --- | --- | --- |
| Student navigation and home | Passage, Workbook, Review | no entry point |
| Admin navigation | Passage, Workbook Factory, Workbook progress | no import or progress entry point |
| Client runtime | `ready/app.js`, `ready/admin/app.js` | this directory |
| Styling | `ready/ready.css`, `ready/design.css` | `question.css`; `legacy-design.css` is the visual regression snapshot |
| Review/export | word, sentence, Workbook | Question export implementation preserved here |
| Server/API | active Workbook-only operations | legacy Question operations remain authenticated and callable only by explicit dormant tooling |
| Data | no Question writes in normal flows | `ready_questions`, `ready_attempts`, bookmarks, AI grading, provenance, and source relations remain unchanged |

## Preserved client entry points

- `student-runtime.js`: the last integrated Student Question runtime snapshot.
- `admin-runtime.js`: the last integrated Admin import/progress runtime snapshot.
- `interaction-runtime.js`, `question-renderer.js`, `question-sheet.js`, `question-paging.js`, `question-difficulty.js`, `question-grading.js`: reusable Question-only modules.
- `admin-attempt-replay.js`, `review-export.js`: dormant replay and print behavior.
- `question.css`: isolated Question presentation rules for a future reactivation.

The active HTML and JavaScript must not import these files. They are exercised by `npm run test:questions:dormant` only.

## Preserved backend and authoring surface

Do not remove or rename Question operations, database tables, migrations, validators, importers, graders, or documentation merely because the UI is dormant. In particular, preserve append-only Attempts and every existing Question/bookmark/provenance relationship.

Authoring and maintenance commands remain explicit developer tools. Active Admin must not call them automatically.

## Reactivation checklist

1. Start a dedicated reactivation change; do not add ad hoc imports to active `app.js`.
2. Review the five `ready/QUESTION_*.md` contracts and current DB migrations.
3. Promote the dormant modules through a new, narrow controller boundary.
4. Load `question.css` only on the reactivated surface; use `legacy-design.css` solely as regression evidence.
5. Run `npm run test:questions:dormant`, active tests, build, native verification, and production read-only QA.
6. Confirm that dormant historical rows were not rewritten during reactivation.

Any new active dependency on this directory is a product decision, not a convenience import.
