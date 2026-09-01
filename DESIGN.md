# READY — Product Design System

> READY is a precise, high-density learning tool for importing English questions, answering them quickly, grading immediately, and resolving mistakes. Its interface combines quiet editorial warmth with decisive product controls. It is not a Breeze derivative and it does not reproduce Cursor, xAI, or SpaceX assets.

**Theme:** warm light, with a dark inverse reserved for decisive moments rather than a general dark UI

**Status:** canonical visual specification. Read this file before changing any Student or Admin UI.

## 1. Product character

READY should feel like a well-typeset exam operated with the speed of a developer tool:

- **Fast:** the next action is apparent within three seconds.
- **Precise:** alignment, labels, counts, and states carry hierarchy.
- **Dense, not cramped:** rows and dividers replace decorative card grids.
- **Quiet:** typography and space do most of the work; shadow and animation do little.
- **Stateful:** selected, grading, correct, wrong, disabled, and unresolved are never ambiguous.
- **Readable:** long Korean instructions and English passages remain the visual center.

The working reference ratio is **80% Cursor-like quiet precision and 20% xAI/SpaceX-like decisiveness**. This ratio is an interpretation principle, not a license to copy a brand.

## 2. Reference extraction

Reference snapshot: `ricocc/brands-design-md` at commit `a3ad408b354e2f0ee7a5702b783e2d4b218955f7`.

Files examined for each of `brands/cursor`, `brands/x.ai`, and `brands/spacex`:

- `DESIGN.md`
- `preview.html`
- `tokens.json`
- `variables.css`
- `theme.css`

Principles retained:

- Cursor: warm `#f7f7f4` canvas, warm near-black ink, restrained orange, 4–8px working radii, hairline separation, compact type-led structure, and minimal shadow.
- xAI: black filled primary actions, quiet monochrome navigation and metadata, visible focus treatment, and decisive text hierarchy.
- SpaceX: short uppercase labels, high contrast at launch/submit/result moments, and a functional, austere tone.

Principles deliberately rejected:

- external logos, proprietary fonts, space imagery, full-site dark treatment, giant marketing display type, pill-everything, and cinematic motion.

## 3. Color tokens

Implementation values live in `design-tokens.css`. Always consume semantic names; do not paste hex values into component rules.

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Canvas | `--ready-canvas` | `#F6F5F0` | uninterrupted page field |
| Canvas quiet | `--ready-canvas-quiet` | `#EFEEE8` | alternate band, disabled row |
| Surface | `--ready-surface` | `#FFFFFF` | input and occasional bounded surface |
| Ink | `--ready-ink` | `#24231D` | headings, question text, strong controls |
| Body | `--ready-body` | `#56544D` | supporting copy |
| Muted | `--ready-muted` | `#7E7B71` | metadata, counts, placeholders |
| Hairline | `--ready-hairline` | `#DEDDD6` | default border and divider |
| Hairline strong | `--ready-hairline-strong` | `#BEBBB1` | hover, selected neutral boundary |
| Orange | `--ready-primary` | `#E84A0C` | start and limited current-progress emphasis |
| Orange hover | `--ready-primary-hover` | `#C93D08` | orange control hover/active |
| Strong action | `--ready-action` | `#11110F` | submit, login, grading completion action |
| Strong action hover | `--ready-action-hover` | `#2A2924` | black control hover |
| Success | `--ready-success` | `#187A55` | correct and resolved |
| Success soft | `--ready-success-soft` | `#E8F4EE` | correct row background |
| Error | `--ready-error` | `#B83A35` | wrong, destructive, failed |
| Error soft | `--ready-error-soft` | `#F8EAE8` | wrong row background |
| Warning | `--ready-warning` | `#A56A09` | pending or caution |
| Warning soft | `--ready-warning-soft` | `#F8F0DC` | pending background |
| Focus | `--ready-focus` | `#24231D` | keyboard outline |

Orange is only for start, the primary route into a question set, and limited current-progress emphasis. Correct and wrong always use semantic green and red. Color is never the only state signal: pair it with a border, icon or text label.

## 4. Typography

No proprietary fonts may be added. Use the system stack declared by `--ready-font-sans`, with `Pretendard` only when it is already safely available on the device. Use `--ready-font-mono` sparingly for question numbers, counts, sources, progress, and compact uppercase labels.

| Role | Token | Size / line height | Notes |
| --- | --- | --- | --- |
| Display | `--ready-text-display` | `32px / 1.12` | READY wordmark or result number only |
| Page title | `--ready-text-title-lg` | `26px / 1.25` | screen title |
| Section title | `--ready-text-title` | `20px / 1.35` | question prompt or section heading |
| Question body | `--ready-text-question` | `17px / 1.66` | English passage and answer text |
| Body | `--ready-text-body` | `16px / 1.55` | default Korean/English prose |
| Small | `--ready-text-small` | `14px / 1.45` | controls and secondary text |
| Meta | `--ready-text-meta` | `12px / 1.35` | counts, sources, progress |
| Eyebrow | `--ready-text-eyebrow` | `11px / 1.3` | uppercase, tracked, short only |

Rules:

- Reading text uses normal sans-serif, never condensed or uppercase.
- Long passages use `16–18px`, `1.55–1.7` line height, and a reading width around `760px`.
- Use weight 600 for hierarchy; avoid a page full of bold text.
- READY, START, SUBMIT, RESULT, and short section eyebrows may be uppercase. Ordinary navigation stays in normal case.

## 5. Spacing

The base grid is 4px.

| Token | Value | Typical use |
| --- | --- | --- |
| `--ready-space-1` | 4px | icon/text micro gap |
| `--ready-space-2` | 8px | compact row internals |
| `--ready-space-3` | 12px | control gap |
| `--ready-space-4` | 16px | default component gap |
| `--ready-space-5` | 20px | content block gap |
| `--ready-space-6` | 24px | section internals |
| `--ready-space-8` | 32px | section separation |
| `--ready-space-12` | 48px | major screen separation |
| `--ready-space-16` | 64px | rare desktop breathing room |

Student question content is comfortable; Admin tables and lists are compact. Do not create empty marketing space that delays the first useful action.

### Padding contracts

Padding is part of the component contract, not a last-minute visual adjustment:

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Page gutter | `24px` minimum | `16px` |
| Rare bounded panel | `24px` | `16px` |
| Answer row | `12px 16px` | `12px` |
| Passage block | `24px 0` | `20px 0` |
| Compact Admin row | `0 12px`, `48px` high | same, inside an overflow container |
| Primary start row | `20px 24px` | `16px` |

All sibling answer rows use the same full available width and padding. A semantic background must fill the complete row, not stop at the text width. Touch targets may extend beyond the visible padding, but visual padding must remain aligned to the reading column.

## 6. Corner radius

- `--ready-radius-xs: 3px` — table cells, tags, indicators.
- `--ready-radius-sm: 5px` — buttons, inputs, answer rows.
- `--ready-radius-md: 8px` — the rare bounded panel or modal.
- `--ready-radius-round: 999px` — avatar/status dots only; not the default control shape.

The visual system should read as rectilinear. Large rounded cards and pill navigation are prohibited.

## 7. Borders, dividers, and depth

- Default boundary: `1px solid var(--ready-hairline)`.
- Strong or selected boundary: `1px solid var(--ready-ink)`.
- Rows may use only a bottom divider; a box is not required.
- Shadows are absent by default. A popover or modal may use `--ready-shadow-float`.
- Do not combine a border, strong background, and shadow unless accessibility requires it.

## 8. Buttons

| Level | Treatment | Use |
| --- | --- | --- |
| Start | orange fill, white text | start a set or route into the core learning flow |
| Strong | near-black fill, white text | submit, login, confirm a decisive action |
| Secondary | surface, hairline border, ink text | safe supporting action |
| Quiet | transparent, ink/body text | navigation, back, low-priority action |
| Destructive | error text/border; fill only on confirmation | delete or irreversible action |

Buttons are 40–44px high on desktop and at least 44px hit height on touch screens. Disabled buttons remain readable and expose disabled state in text or affordance, not opacity alone.

## 9. Forms and inputs

- Labels sit above controls and remain visible after typing.
- Inputs use a white surface, hairline border, 5px radius, and `16px` text on mobile to avoid browser zoom.
- Focus uses a 2px ink outline with a 2px offset.
- Errors appear directly below the field with error text and an error border.
- Written answers remain visible while AI grading runs. Only the submit region changes to a grading state.
- No full-screen spinner for localized work.

## 10. Question layout

The question screen is READY's primary artifact. It combines paper-exam readability with digital state and navigation.

Order:

1. compact metadata row: `08 / 42`, type, source, progress;
2. question prompt;
3. English passage or the exact contract-provided material;
4. answer interaction;
5. submit/status area.

The reading column is `min(760px, 100%)`. On wide screens, optional progress/navigation may occupy a narrow rail without shrinking the passage below a comfortable reading width. Do not wrap every sentence or sub-block in a card. Use typography, dividers, and restrained surface differences.

The renderer must display the existing Question and Interaction Contracts exactly. Design may restructure DOM for accessibility, but it must not infer missing content, introduce a question type, or reinterpret an interaction.

## 11. Answer choices and states

An answer choice is a row, not a promotional card.

- **Idle:** surface/canvas background, hairline divider, quiet number marker.
- **Hover:** subtle canvas-quiet fill and strong hairline.
- **Focus:** 2px visible ink outline.
- **Selected:** ink border plus `선택됨` semantics; the number and text gain weight.
- **Correct:** success border/background, check icon, `정답` label.
- **Wrong:** error border/background, cross icon, `내 답안` label; the actual correct row remains marked.
- **Disabled/unselected after submit:** reduced text weight while remaining legible.

The entire visual row is the hit target. Minimum touch height is 48px.

### Choice matrix

Desktop uses aligned columns with the choice number as the row header. Mobile collapses each row into a numbered block with explicit `(A)`, `(B)`, and later column labels. Selection always applies to the whole row. Never flatten matrix data into an opaque string.

### Multiple choice

Multi-select controls show both the checkbox affordance and a short instruction such as `2개 선택`. The visual state must match the Contract's actual selection limit.

## 12. Written questions

Maintain this scan order when the corresponding contract fields exist:

`Prompt → relevant passage → Korean target → conditions → word bank → answer input → submit`

Use small section labels and dividers. A `CONDITIONS` block is a numbered compact list; a `WORD BANK` is a wrapping token list without decorative pills. Multiple answer slots, ordering, fragments, and single-sentence inputs must map one-to-one to the interaction contract.

AI grading states:

- button label changes to `채점 중` with a small inline progress mark;
- input and submitted answer remain visible;
- unrelated navigation remains available when safe;
- completion is announced through the existing live region.

## 13. Feedback

Feedback is explicit but restrained.

- Correct: short `CORRECT`/`정답` label, success rule, answer confirmation.
- Wrong: short `INCORRECT`/`오답` label, both `내 답안` and `정답` identified.
- Explanations use normal body type below a divider.
- No confetti, bounce loop, large emoji, or game-like reward surface.

## 14. Navigation

### Student

- READY wordmark left; Home and Review routes remain compact.
- The home screen leads with one strong `바로 시작` action, followed by the three existing learning modes.
- Passage and source inventory use compact rows with counts and a trailing action.
- The current source and available count are visible before starting.

### Shorts

- Preserve one screen = one question.
- Preserve mobile vertical swipe, desktop wheel/trackpad, and arrow-key navigation.
- Progress is small and exact; navigation must not cover question content.
- Internal passage scroll takes precedence until its boundary is reached.
- Unsubmitted answers and submitted feedback persist across navigation.
- Transition duration is `120–180ms`; respect reduced motion.

### Admin

- Navigation favors tool-like density: Students, Passages, Questions/Sources where currently available, and Scope.
- Current route uses ink and a thin underline/rule, not a large colored pill.
- Filters align in a compact toolbar and remain usable on mobile through wrapping or controlled horizontal scrolling.

## 15. Lists, tables, and cards

- Use a **row/list** when items share the same fields or action.
- Use a **table** for aligned operational comparisons such as Source / Total / READY / DROP.
- Use a **card/panel** only when a group requires a distinct interaction boundary, such as authentication or a modal.
- Avoid nested cards.
- Admin row heights target 44–52px; metadata aligns to columns and uses tabular numerals.
- Destructive actions are spatially separated from routine actions and use error color.

## 16. Responsive behavior

Required verification widths: `390px`, `768px`, and `1440px`.

- `390px`: one content column, 16px side gutter, stacked choice matrices, no horizontal page overflow.
- `768px`: one readable question column; toolbars may wrap to two rows.
- `1440px`: centered reading column, optional narrow navigation rail, Admin tables use available width.
- Use `overflow-wrap:anywhere` for unbroken tokens but preserve normal English word wrapping first.
- Fixed actions include safe-area padding and never cover inputs or answer choices.
- Keyboard focus must remain visible after responsive reflow.
- A touch target may be larger than its visible border; do not inflate every visual container.

## 17. Loading, empty, and error states

- **Loading:** preserve the final layout footprint; use a small inline progress indicator or restrained skeleton.
- **Empty:** name what is absent and provide one next action, e.g. `이 출처에는 풀 수 있는 문제가 없습니다.`
- **Error:** show a short actionable message; never expose a raw server error. Offer retry only for safe reads.
- **Disabled:** keep content legible and explain why an action is unavailable where ambiguity exists.

## 18. Motion

- Interaction feedback: `120ms`.
- Screen/Shorts transition: `160ms`.
- Modal/panel transition: no more than `200ms`.
- Animate opacity and transform only; avoid layout animation.
- No ambient loops, parallax, cinematic reveal, or celebratory animation.
- Under `prefers-reduced-motion: reduce`, remove nonessential transitions and all smooth scrolling.

## 19. Reader word learning

Reader lookup is an in-prose state change, not a dictionary overlay. The English
token becomes a short rectangular block immediately after tap, then resolves in
place to a Korean contextual gloss. Do not add a popover, rounded dictionary
card, spinner, glow, bouncing motion, or loading underline.

- **Tap / pending:** use `--ready-word-block` plus the orange
  `--ready-word-block-edge`. This means “working now.” It must remain distinct
  from prior-learning tint.
- **Gloss:** Korean is ordinary reading text with button semantics but no button
  chrome. Long contextual glosses may reflow naturally and must never be
  clipped, marquee-scrolled, or compressed to the English width.
- **Save toggle:** `✓` and `−` share one fixed visual box. The visible mark is
  small, while a pseudo-element extends the touch target. The sentence must not
  shift when the mark changes.
- **Return:** canonical English returns through a 560ms opacity-led dissolve.
  Geometry stays fixed; blur is limited to a sub-pixel midpoint and disappears
  under reduced motion.
- **Memory tint:** only saved English tokens receive level 1/2/3 olive-neutral
  backgrounds. Level 1 is barely present, level 2 is readable on inspection,
  and level 3 is strongest without becoming a highlighter field. Lookup block
  remains orange and must never reuse these tints.
- **Question/Workbook future rule:** hide memory tint during solving. A submitted
  or result state may reveal the same level 1/2/3 scale later; this design pass
  does not add lookup behavior to either surface.

Word Review uses four aligned navigation cells with visible counts: `WORD`,
`SENTENCE`, `WORKBOOK`, `QUESTION`. Word rows prioritize lemma, then core Korean
meaning, then memory metadata. Expanded context history uses compact rows and
thin dividers instead of nested cards. Meaning add/delete and saved-word removal
may be explicit here because Review is the management surface.

## 20. Forbidden patterns

- Breeze visual identity, serif display typography, scenic imagery, or blue brand accent.
- Wrapping every element in a rounded card.
- Large shadows, glassmorphism, neon, decorative gradients, or excessive pills.
- Orange for correct/wrong or for every action.
- Proprietary fonts or external brand logos/assets.
- Giant marketing hero sections.
- Childish learning-game decoration.
- Hidden focus outlines or color-only state distinctions.
- New UI framework introduced for the redesign.
- Question Contract, Interaction Contract, importer, validator, grader, Attempt, READY/DROP, source filter, Shorts behavior, Workbook, authentication, API, or DB changes made for visual reasons.

## 21. Implementation gate

Before changing production UI:

1. read this document and `UI_AUDIT.md`;
2. compare the intended component against `design-preview.html`;
3. map old visual tokens to semantic `--ready-*` tokens;
4. preserve event handlers, IDs, data attributes, ARIA/live regions, and contract-shaped DOM;
5. run existing READY tests and build;
6. verify Student and Admin at 390, 768, and 1440px;
7. verify keyboard focus, zero horizontal overflow, and zero console errors.

The success criterion is not resemblance to a reference brand. It is a faster, more precise, more readable READY product with one consistent visual grammar.
