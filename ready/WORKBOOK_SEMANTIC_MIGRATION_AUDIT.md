# Production Workbook semantic-v2 migration audit

Date: 2026-09-04

Production replacement status: **BLOCKED**. The immutable production golden
contains 13 legacy catalogs, but not every original full Workbook PDF and
Answer Key has been uniquely matched to its passage. An old catalog is never an
input to semantic-v2 regeneration. No production catalog was overwritten.

`pending source match` is an unresolved state, not a zero. Publication requires
all rows to show `source verified`, exact Stage 1-7 counts and `unresolved=0` in
one dry-run batch.

| Workbook | Original PDF run | Old items | New S1-S7 | legacy correction dropped | paragraph-order dropped | S7 whole-sentence converted | unresolved |
|---|---:|---:|---:|---:|---:|---:|---:|
| sol-direct-05fc12fd-3956-4db8-925d-32475a7e8b1e | pending canonical match | 205 | — | 10 expected | pending | pending | source unresolved |
| sol-direct-2026-06-21 | pending canonical match | 30 | — | 1 expected | pending | pending | source unresolved |
| sol-direct-2026-06-18 | pending canonical match | 28 | — | 1 expected | pending | pending | source unresolved |
| sol-direct-2026-06-26 | pending canonical match | 29 | — | 1 expected | pending | pending | source unresolved |
| sol-direct-2026-06-20 | pending canonical match | 25 | — | 1 expected | pending | pending | source unresolved |
| factory-741d6581-1f4c-4e1d-823c-6be85c62bf52 | original PDF missing | 174 | — | 14 expected | pending | pending | source missing |
| sol-direct-2026-06-23 | pending canonical match | 25 | — | 1 expected | pending | pending | source unresolved |
| sol-direct-2026-06-24 | pending canonical match | 32 | — | 1 expected | pending | pending | source unresolved |
| sol-direct-a1335d49-5dc5-4e42-9f81-9f340648ff95 | pending canonical match | 126 | — | 8 expected | pending | pending | source unresolved |
| sol-direct-2026-06-19 | pending canonical match | 25 | — | 1 expected | pending | pending | source unresolved |
| factory-c2135f14-420a-4b08-a0a2-466b1a3aa8ff | original PDF missing | 163 | — | 14 expected | pending | pending | source missing |
| factory-f0577279-29fe-4923-bdca-ab5bccc64fca | original PDF missing | 177 | — | 10 expected | pending | pending | source missing |
| sol-direct-2026-06-22 | pending canonical match | 34 | — | 1 expected | pending | pending | source unresolved |

The June mock-exam source PDF is a candidate for the numbered mock passages,
but each passage section must still pass exact canonical comparison before it
can change from `pending` to `verified`. The attached Donga textbook PDF and the
repository NE PDF likewise cannot be assigned to a production catalog by title
or item count alone.

## Required atomic publish gate

1. Resolve and hash every original PDF.
2. Extract the matching canonical section and Answer Key from that PDF.
3. Run the semantic-v2 importer; do not read old item payloads.
4. Review expected and unexpected diffs.
5. Require semantic validation, one-word Stage 6 chips, whole-sentence Stage 7,
   zero correction/paragraph-order exposure, zero model calls and unresolved 0.
6. Compare Question, exam-passage, passage/sentence, attempt and bookmark
   relationship digests before and after.
7. Replace all active catalogs atomically; otherwise replace none.
