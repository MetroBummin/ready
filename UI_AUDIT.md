# READY UI Audit — Pre-redesign

Audit date: 2026-08-31  
Baseline: `main` at `491dd3f`  
Scope: read-only inspection of Student/Admin HTML, dynamic renderer templates, CSS, and visual states.

This audit separates visual work from Question Contract, importer, grader, API, database, and authentication behavior. The implementation phase must preserve the hooks listed under **Risk boundaries**.

## Screen inventory

### Student

1. Student chooser and loading/empty state: `#student-home`, `.student-grid`, `.student-button`.
2. PIN login: `#pin-login`, `#pin-form`, `.auth-card`, remember checkbox.
3. Authenticated Home: `#student-sets`, `.home-head`, `.start-study`, `.passage-list`, `.passage-row`, disabled/completed/no-scope states.
4. Source/type selection, injected into `#student-sets`: `.filter-head`, `.question-source-grid`, `.question-type-grid`, `.question-filter-option`.
5. Passage reader: `#student-reader`, `.study-back`, `.reader-document`, `.reader-lede`, `.reader-prose`.
6. Question Shorts: `#student-questions`, `.question-layout[data-question-phase]`, progress, bookmark, stimulus/passage/summary, answer rows, choice matrix, written input, submit, AI grading, feedback, swipe states, and Shorts cue.
7. Review: reuses the Question renderer with `mode='review'`; it is not a separate review-list screen.
8. Workbook: `#student-workbook`, tabs, blank/choice/correction/order tasks, retry/result states.
9. Global: busy, toast, safe area, responsive rules, and current dark theme.

### Admin

1. Login.
2. Students: create form, filters, table, PIN reset, delete.
3. Passages: filters, verified Question bundle import, table/pagination, assignment, mixed-grade error.
4. Passage edit side sheet.
5. Delete confirmation and impact list.
6. Scope overview.
7. Scope detail with sticky toolbar, selection rows, and save.
8. Global busy, toast, and current dark theme.

## KEEP

Keep behavior and semantics; only visual values may change:

- `[hidden]`, `.view`, `.view.on`, `.modal`, `.modal.on`, and `body.study-mode` display behavior.
- Question phase/state classes: solving, submitted, selected, correct, wrong, candidate, eliminated, swiping, bookmark active, result dots.
- Workbook active/correct/wrong/selected/disabled states.
- `:focus-visible`, reduced-motion, safe-area, mobile overflow, and table overflow protections.
- Touch/pointer drag transforms and long-passage scroll boundary behavior.
- Mobile form control sizing that prevents browser zoom.
- ARIA labels, live regions, and existing status announcements.

## RESTYLE

- READY shell, canvas, typography, logo, navigation, fields, buttons, and surface hierarchy.
- Student chooser, PIN, Home, source/type filters, passage rows, Question renderer, answer rows, choice matrix, written inputs, feedback, Review entry, and Workbook.
- Admin login, navigation, filters, forms, dense tables/lists, scope screens, and sheets.
- Current READY screens inherit Breeze blue, Fraunces, paper texture, large radii, and shadows from shared `styles/tokens.css`, `styles/base.css`, and explicit READY overrides. Replace this dependency with scoped `--ready-*` semantic tokens; do not broadly rewrite shared Breeze tokens.

## SIMPLIFY

- Collapse layered `.card` overrides, large padding, shadow, and radius into a small number of bounded-panel rules.
- Replace student chooser, `.start-study`, source/type option cards, scope cards, passage selection cards, and Workbook nested cards with rows, dividers, or restrained surfaces.
- Replace pill-like word-bank and secondary controls where the shape does not communicate interaction.
- Consolidate duplicated Question/Reader rules and repeated `max-width:700px` media blocks.
- Convert Admin scope overview from a large card grid to a denser aligned list/table where its data shape allows it.

## DELETE CSS CANDIDATES

Delete only after static usage checks, fixtures, and full tests:

- Lexical/Breeze reader remnants: `ready-word-*`, `learning-sheet`, `reader-token`, saved-word/sentence, sense/word modal/dock selectors. Runtime tests already assert lexical controls are absent.
- Old review-list selectors such as `home-tabs`, `review-list`, `review-item`, `review-row`, `review-delete`, and related heads/tabs. Review now reuses the Question renderer.
- Sentence-card reader rules superseded by continuous prose.
- Apparently unreferenced `.textbook-course`, `.backline`, `.reader-hint`, `.study-meaning`, `.study-source`, `.sheet-section`, `.sheet-sentence`, `.answer-reveal`, and `.written-response`.
- Older `.question-block`, `.question-segment`, `.question-image`, `.question-footnote`, and `.choice-separator` only if interaction fixtures confirm they are not emitted.

Do not delete shared `styles/base.css` or `styles/tokens.css` just because READY stops consuming their visual tokens; those files may still belong to Breeze surfaces.

## Risk boundaries

`ready/app.js` mixes dynamic markup with business state. Visual changes must preserve:

- Screen IDs used by `show()`: `student-home`, `pin-login`, `student-sets`, `student-reader`, `student-questions`, `student-workbook`, `student-library`.
- `#busy`, `#toast`, `#student-nav`, and `#logout`.
- Every delegated-event `data-*` hook for routing, starting, exiting, submitting, bookmarking, explanations, question choices, inline answers, and Workbook controls.
- Contract controls and their cardinality, especially `data-written-slot`, `data-contract-device`, and `data-choice-column`.
- `.question-layout[data-question-phase]`, response state classes, `--choice-drag`, touch-action, and scroll-boundary rules.
- Submitted response DOM during AI grading.

Admin changes must preserve fixed IDs, `data-route`, `.view.on`, modal `.on`, dynamic form IDs, selection/delete hooks, and the Question import form's exact behavior.

## Before evidence

Captured from the clean baseline in `artifacts/before/`:

- `student-login-1440.png`
- `student-login-390.png`
- `admin-login-1440.png`
- `admin-login-390.png`

Authenticated and contract-specific states require a fixture or valid local session. Do not add production routes or inference logic just to make screenshots easier.

## Implementation order after the import/Shorts branch lands

1. Rebase or merge the latest `main` into `codex/ui-redesign` and resolve visual conflicts without undoing functional changes.
2. Apply scoped READY tokens and shell typography.
3. Restyle Login, Home, source selection, Question, choices/matrix, written input, feedback, Review, then Workbook.
4. Run Student regression tests before starting Admin.
5. Restyle Admin navigation, forms, filters, tables/lists, scope screens, and sheets.
6. Remove only verified dead CSS.
7. Run complete tests/build and verify 390, 768, and 1440px with screenshots and console checks.

## Implementation status — 2026-08-31

Completed on `codex/ui-redesign` after merging `main` at `1e67d49`:

- Wired the canonical `design-tokens.css` into Student, Admin, and the Pages build.
- Added `ready/design.css` as the production-only presentation layer.
- Reduced `ready/ready.css` from 381 lines of mixed Breeze/lexical/visual rules to 107 lines of structural compatibility rules.
- Removed legacy lexical dock/sheet styling, sentence-card styling, old standalone review-list styling, Breeze typography, paper texture, oversized radii, and layered card shadows from READY.
- Restyled Student chooser/PIN/Home/source filter, the existing Question renderer, choice matrix, written/AI feedback states, Review's shared renderer, Workbook, Admin login/forms/tables/scope screens, sheets, loading, empty, and error states.
- Preserved `ready/app.js`, `ready/admin/app.js`, `ready/interaction-runtime.js`, importer, grader, API, migrations, and all Contract hooks relative to the merged `main`.
- Added `tests/ui-harness.html` to visually exercise production selectors without creating a production route or bypassing authentication.
