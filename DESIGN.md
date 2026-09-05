# READY — Passage Mastery Design System

> READY helps a student master one canonical English passage through short, calm, repeated workbook practice.

**Product character:** Monochrome Utility, Human Touch — warmed, softened, and tuned for students.

**Status:** canonical direction for future READY design work. Read this document before changing Student or Admin UI.

## 1. Product character

READY is a **Passage Mastery Workbook**, not a digital exam paper. Its interface should make a large amount of practice feel small, clear, and finishable.

The product should feel:

- **Calm:** near-monochrome surfaces and restrained motion reduce fatigue.
- **Immediate:** each screen presents one obvious next action.
- **Tactile:** generous touch targets and soft geometry invite interaction.
- **Warm, not decorative:** off-white canvas, clear typography, and the bear add humanity without becoming a theme.
- **Trustworthy:** canonical passage text, deterministic exercises, answers, and mastery states remain explicit.
- **Lightweight:** opening READY should feel like doing one small step, not starting a study session.

The desired student thought is not “I am taking a test.” It is:

> “A little more and I will know this passage.”

## 2. Product hierarchy and Workbook-first principle

The Student hierarchy is:

1. **Today:** what to continue now.
2. **Passage:** the canonical source being mastered.
3. **Workbook loop:** one short decision or recall action at a time.
4. **Feedback:** immediate, quiet confirmation and correction.
5. **Mastery:** visible progress across learning dimensions.
6. **Review:** weak items return at useful intervals.

Workbook is the primary Student product surface. Its long-term mastery axes are:

- **Content:** facts, content agreement, and O/X judgments.
- **Core:** topic, title, and main idea.
- **Structure:** sequence, insertion, A–B–C, and sentence arrangement.
- **Sentence:** deterministic recall, blank, correction, and ordering stages.
- **Meaning:** sentence interpretation and meaning recall.

Actual exam questions are normally completed on paper. Existing Question features, representations, importers, and data remain preserved but dormant. They are not the visual center of the Student experience and must not drive new navigation or home hierarchy.

## 3. Design references

### Primary — Cal.com

Use Cal.com as a reference for **Monochrome Utility, Human Touch**:

- almost-black actions on white or off-white fields;
- quiet neutral hierarchy;
- concise product copy;
- rounded, useful controls;
- white functional surfaces with very light edges or elevation;
- generous spacing that still feels operational.

READY interprets this direction as warmer, softer, more rounded, and more student-facing. Do not copy Cal.com layouts, fonts, assets, logos, or scheduling metaphors.

### Secondary — approachable consumer-product behavior

Use only these general traits:

- clear hierarchy and one dominant action;
- large touch targets;
- rounded controls;
- complex progress made easy to scan;
- low-friction transitions and quick continuation.

Do not imitate another company’s brand, signature color, illustration language, or component library.

## 4. Colors

READY should look black and white at first glance and only slightly warm after prolonged use.

| Role | Proposed token | Direction | Use |
| --- | --- | --- | --- |
| Canvas | `--ready-canvas` | `#F6F6F3` | page background |
| Quiet canvas | `--ready-canvas-quiet` | `#EFEFEB` | progress track, selected neutral, disabled area |
| Surface | `--ready-surface` | `#FFFFFF` | workbook and bounded functional surfaces |
| Ink | `--ready-ink` | `#1B1B1A` | primary text and action |
| Body | `--ready-body` | `#50504D` | supporting copy |
| Muted | `--ready-muted` | `#7B7B75` | metadata and placeholders |
| Hairline | `--ready-hairline` | `#DFDFD9` | quiet edge and divider |
| Strong hairline | `--ready-hairline-strong` | `#C9C9C2` | focus-adjacent neutral edge |
| Action | `--ready-action` | `#1B1B1A` | primary action and selected state |
| On action | `--ready-on-action` | `#FFFFFF` | text on dark actions |
| Success | `--ready-success` | restrained green | correct and mastered only |
| Error | `--ready-error` | restrained red | incorrect and destructive only |
| Warning | `--ready-warning` | restrained amber | pending or attention only |

Rules:

- Do not introduce a general-purpose brand accent into every screen.
- Use semantic color only when it communicates learning state.
- Never rely on color alone; pair it with text, icon, shape, or position.
- Avoid yellow cream, brown beige, or clinical pure-white fields across the entire app.
- Dark mode may invert the neutral hierarchy but must remain soft and low-glare.

These values are a future token direction. Updating this document or the preview does not silently change production tokens.

## 5. Typography

Use available system sans-serif fonts. Do not import proprietary reference fonts.

| Role | Mobile size / line height | Desktop size / line height | Character |
| --- | --- | --- | --- |
| Display | `34 / 1.08` | `48 / 1.05` | rare milestone or preview hero |
| Page title | `26 / 1.2` | `32 / 1.18` | Today, passage, mastery title |
| Section title | `20 / 1.3` | `22 / 1.3` | clear local hierarchy |
| Workbook prompt | `18 / 1.48` | `19 / 1.48` | the current judgment or recall task |
| Reading text | `17 / 1.72` | `18 / 1.72` | canonical English passage |
| Body | `15 / 1.55` | `16 / 1.55` | default copy |
| Small | `13 / 1.45` | `14 / 1.45` | supporting labels |
| Meta | `12 / 1.35` | `12 / 1.35` | compact counts and state |

Use weights 450–700. Strong hierarchy should come from size, placement, and whitespace before heavy bold. Use tabular numerals for mastery percentages, counts, and Admin comparisons. Uppercase is reserved for very short system labels and must not dominate Student screens.

## 6. Spacing

Use a 4px base rhythm with practical steps: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

- Mobile page gutter: `16px`, optionally `20px` on roomy devices.
- Desktop content gutter: `24–32px`.
- Workbook surface padding: `20–24px` mobile, `28–32px` desktop.
- Choice gap: `10–12px`.
- Section gap: `24–32px` within a learning screen.
- Major home sections: `40–56px`.
- Compact Admin rows: `44–52px` high.

Whitespace should lower cognitive load, not delay the first task. A Student screen should expose useful content within the first viewport.

## 7. Corner radius

Rounded geometry is part of READY’s friendly utility.

| Role | Radius |
| --- | --- |
| Compact control | `12–16px` |
| Button and input | `16–20px` |
| Normal card | `18–24px` |
| Large learning surface | `20–28px` |
| Chip and status | full pill allowed |
| Icon button | circular allowed |

Not everything becomes a bubble. Long passages, explanations, and reading content may remain flat. Round interactive boundaries and grouped learning surfaces; do not wrap every text block in another card.

## 8. Surfaces and depth

The standard hierarchy is:

`warm canvas → white functional surface → quiet inset state → dark action`

- Use a white surface when a task needs one clear interaction boundary.
- Prefer a subtle `1px` warm edge or very soft shadow; usually not both.
- Shadows should suggest touchable separation, never floating spectacle.
- Avoid nested cards. Inside a workbook surface, use spacing or quiet fills.
- Passage reading can sit directly on the canvas or a broad flat surface.
- Modals and bottom sheets may use stronger elevation because they change interaction ownership.

## 9. Buttons

- **Primary:** near-black fill, white text, `48–54px` height, `16–20px` radius.
- **Secondary:** white or quiet fill, ink text, subtle edge.
- **Quiet:** transparent, no decorative container unless a touch boundary is needed.
- **Icon:** circular or rounded square with at least a `44px` hit area.
- **Destructive:** restrained error treatment and spatial separation.

Button labels should describe the next action: `계속하기`, `정답 확인`, `다시 풀기`, `다음 단계`. Avoid generic `확인` when the result is ambiguous. Disabled actions stay readable and explain the missing prerequisite when needed.

## 10. Workbook choices and interactions

Every workbook item asks for one understandable action.

- Minimum touch target: `48px`; preferred Student choice height: `54–64px`.
- Choice surfaces may be softly rounded and separated by `8–12px` gaps.
- Selected state uses near-black fill or a strong ink edge, not a loud accent.
- O/X uses two large, equally legible decisions.
- Ordering uses stable chips or tiles; selected items move without layout jumps.
- Blank and recall inputs begin compact and grow only when necessary.
- Correction clearly pairs source and replacement.
- Translation keeps the canonical sentence visible while the student responds.
- The next item should arrive quickly without unnecessary confirmation.

Never expose importer names, internal stage IDs, raw schema labels, or grading machinery to students.

## 11. Passage reading surfaces

The canonical passage is the source of truth and should feel readable rather than boxed in.

- Reading width: approximately `680–760px`.
- Reading size: `17–18px` with `1.65–1.75` line height.
- Use natural paragraphs and sentence rhythm.
- Avoid a border around every paragraph or sentence.
- Highlight only the span currently required by the workbook task.
- On mobile, page scrolling is preferred over unnecessary nested scrolling.
- When passage and task appear together on wide screens, keep both visible without shrinking the reading column below comfort.

## 12. Mastery and progress

Progress should make a large workload feel like a series of attainable steps.

Student mastery may show:

- today’s assignment;
- current passage completion;
- Content, Core, Structure, Sentence, and Meaning mastery;
- weak items due for review;
- the next small milestone.

Use one primary progress statement and a compact supporting breakdown. Bars, rings, percentages, and counts are allowed, but avoid arcade meters, rank ladders, streak pressure, and reward economies. A mastery state must combine numeric progress with a plain-language label such as `익숙해지는 중`, `거의 다 외웠어요`, or `복습 필요`.

## 13. Feedback

Feedback is immediate, brief, and useful.

- **Correct:** restrained green, check, and a short confirmation.
- **Incorrect:** restrained red, the correct form or comparison, and a clear retry path.
- **Near mastery:** neutral encouragement plus the next remaining step.
- **Completed passage:** a calm completion surface; the bear may appear once.
- Keep the submitted response visible during checking.
- Do not interrupt rapid practice with modal confirmation, confetti, bounce, or long praise.

## 14. Navigation

Student navigation should emphasize `Today`, `Workbook`, and `Review`. The active passage and progress are more important than the total product inventory.

- Mobile: compact top bar plus a restrained bottom navigation when persistent switching is genuinely useful.
- Desktop: simple top or side navigation with clear current state.
- Back controls use familiar chevrons and large invisible hit areas.
- The dominant action belongs to the current learning loop, not global navigation.
- Question-related routes may remain accessible for maintenance or legacy use but should not occupy primary Student navigation.

## 15. Bear mascot usage

The existing READY bear is an **emotional softener**, not a game character.

Good placements:

- Home greeting;
- empty state;
- loading or quiet waiting;
- completed passage;
- meaningful mastery milestone;
- gentle return-to-study encouragement.

Avoid:

- every workbook item or button;
- continuous animation;
- placement beside dense reading text;
- replacing state icons or instructional clarity;
- introducing a new bear identity without explicit approval.

Keep the bear simple, mostly monochrome, soft, and small enough to preserve hierarchy.

## 16. Student UI

Student UI is friendly, generous, rounded, and low in cognitive load.

The home screen should answer three questions immediately:

1. What should I do now?
2. Which passage am I mastering?
3. How close am I to finishing?

Prefer one large continuation surface, a compact passage list, and a simple mastery summary. During practice, keep one decision in focus and remove metadata that does not help solve it. Support 50–100 consecutive interactions without visual fatigue.

## 17. Admin UI

Admin may be denser because comparison and operation speed are primary.

- Tables and aligned lists are appropriate.
- Show Student, Passage, assignment, completion, mastery axes, and review need in comparable columns.
- Use compact filters and tabular numerals.
- Preserve the same warm canvas, typography, neutral hierarchy, rounded controls, and semantic colors.
- Avoid turning every row into a large Student-style card.
- Destructive actions remain separated and explicit.

## 18. Responsive behavior

Required design verification widths: `390px`, `768px`, and `1440px`.

- **390px:** one column, 16px gutter, large touch targets, no horizontal page overflow.
- **768px:** generous single-column Student layout; Admin tools may wrap or scroll deliberately.
- **1440px:** centered passage/workbook composition; Admin uses available width for comparison.
- Fine-pointer layouts may show passage and workbook together.
- Touch layouts prioritize one focused interaction and natural page scrolling.
- Safe areas and the software keyboard must never cover the current answer or primary action.

Responsive changes must preserve content ownership and interaction meaning; do not duplicate the learning content into separate mobile and desktop implementations.

## 19. Motion

Motion is fast, soft, and almost invisible after repetition.

- Touch response: `80–120ms`.
- Item transition: `140–180ms`.
- Panel transition: at most `220ms`.
- Animate opacity and transform where possible.
- Use motion for touch acknowledgment, progress update, next item, and completion only.
- Avoid bounce, parallax, ambient mascot movement, elaborate page transitions, and repeated celebration.
- Respect `prefers-reduced-motion` and remove nonessential animation.

## 20. Accessibility

- Meet WCAG AA contrast for text and controls.
- Keep visible `:focus-visible` treatment.
- Maintain at least `44×44px` touch targets.
- Use semantic controls, labels, status text, and live regions.
- Do not communicate correct/incorrect/mastered by color alone.
- Support text enlargement without clipping or horizontal page overflow.
- Keep answer focus visible when the software keyboard changes the viewport.
- Preserve logical reading and tab order.
- Avoid forced time pressure and motion-dependent meaning.

## 21. Do / Don’t

### Do

- Put Workbook and passage mastery first.
- Make one next action obvious.
- Use warm near-monochrome foundations.
- Round interactive surfaces generously.
- Keep passages flat and readable.
- Make progress calm, concrete, and attainable.
- Use the bear sparingly at emotional moments.
- Preserve canonical content and existing product contracts.

### Don’t

- Present READY as an exam-question database.
- Make Question the default Student destination.
- Reproduce paper worksheets as the main digital experience.
- Wrap every block in a card or pill.
- Use beige branding, gradients, heavy shadows, neon, or glass effects.
- Gamify with confetti, coins, rankings, or pressure streaks.
- Add mascot decoration to every interaction.
- Change data, grading, importer, or learning contracts for visual convenience.

## 22. Implementation guidance

This document defines the destination, not permission for a broad rewrite.

Before production UI work:

1. Read this document and inspect the current product contract.
2. Use `design-preview.html` as the visual conversation surface, not as production code.
3. Map proposed values to semantic `--ready-*` tokens in a separately reviewed token change.
4. Implement Student surfaces in order: Home → passage selection → Workbook loop → feedback → mastery → Review.
5. Treat Question code and data as dormant preserved capability; do not delete or migrate them incidentally.
6. Preserve IDs, delegated-event hooks, ARIA/live regions, attempts, bookmarks, and deterministic Workbook behavior.
7. Change Admin density separately after the Student direction is stable.
8. Run existing tests and verify 390, 768, and 1440px with keyboard, focus, overflow, reduced motion, light/dark, and long-content cases.

The success criterion is not resemblance to a reference brand. It is that repeated passage practice feels calm, approachable, fast, and visibly effective.
