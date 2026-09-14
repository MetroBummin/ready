# READY repository rules

## Full Workbook imports

- Use the shared `studio_publisher_import` path for both Admin uploads and `npm run workbook:import`; do not add a one-off PDF parser or passage-specific repair script.
- A full publisher Workbook is a conversion task. Never call AI, invent an Authoring item, or fill a failed extraction from canonical text.
- Determine semantic type from the heading, instruction, problem structure, and answer-key structure. Printed stage numbers are provenance, not the READY type contract.
- Require publisher prompt, answer-key link, canonical round-trip, and independently counted source items for all four Authoring types. Ambiguous input stays unpublished.
- Existing imports must keep passage and sentence IDs, canonical text and translation, exam links, claim bank, attempts, bookmarks, and history. Apply only through the per-passage atomic RPC after a successful dry-run.
- Record the exact PDF bytes, SHA-256, source locator, source/answer pages, source exercise ID, and validator version. A system-validated publisher import is `publisher_verified`, never teacher/manual confirmation.
- Passage-only documents use the separate reviewed draft path and do not auto-create Authoring.

The operational contract and command format are documented in `ready/WORKBOOK_IMPORT.md`.
