# Word import without any database schema changes

## Owner decision
Do NOT create `word_import_batches`, `word_import_items`, or `question_formula_sources`.
Do NOT change existing tables or columns.

## Data lifecycle
1. Read Word DOCX/OMML in browser and retain the original math tree *temporarily* for review.
2. Convert to LaTeX, validate against OMML and render, and verify question, A-D, grading answers, counts and unsupported media. Fail closed if any formula is unverified.
3. Validate complete payload again at the server. Derive stable question IDs from SHA256(teacher ID + original DOCX file hash) and question position, not from client-controlled IDs.
4. Persist `content`, `options`, `answer`, etc., exclusively into existing `questions` with a Serializable PostgreSQL transaction. Verify full exact field values inside the same transaction.
5. Read back every inserted question and compare fields; allow safe retry if the file was already imported and current fields still match exactly. Reject collisions or changes rather than silently overwrite.

## Trade-offs
- No persistent OMML provenance, original DOCX or batch audit records (by explicit owner choice).
- Duplicate-file detection is limited to unchanged imported questions still bearing stable IDs; if all imported questions are deleted, the same file may be imported again.
- Original source remains with the teacher, not in Neon. Edits do not update OMML provenance because none is persisted.
- Success for all arbitrary Word documents is not possible. Unsupported or ambiguous formulas must be reported and cannot be silently saved.
- No new migration is necessary. The existing `questions` schema remains unchanged.
- Same maximum Word payload limits and image upload behavior. R2 can contain unattached images if import transaction subsequently fails; cleanup is a separate improvement.
- CI/PGlite tests do not replace real Neon staging E2E checks.

## Acceptance
- [ ] CI and production build pass on this exact branch.
- [ ] Chromium/Word preview, grading format and DOCX export pass.
- [ ] Real DOCX with math in stem, options and short answers; all fields compared with source.
- [ ] Independent Neon staging: authenticated full HTTP import -> readback -> student exam -> export Word.
- [ ] No schema changes or changes to existing production data.
- [ ] Production rollback evidence and owner approval before merge.
