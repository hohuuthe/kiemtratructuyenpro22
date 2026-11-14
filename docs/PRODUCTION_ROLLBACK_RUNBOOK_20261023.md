# Production release & rollback runbook — 2026-10-23

## Baseline (verified from GitHub)
- Repository: `hohuuthe/kiemtratructuyenpro22`
- Pre-import production source commit: `1bb7a1f004cf075ffcf04b9ab10df9dc24278cbf`
- Immutable-intent Git branch: `backup/production-before-word-import-20261023` (DO NOT merge/delete/rewrite)
- Baseline GitHub Actions: successful at this SHA.
- Baseline Cloudflare Pages check: successful at this SHA. Record deployment ID, custom domain and actual serving production build via the Cloudflare dashboard before any change.
- Import feature candidates remain in PR #12 and nested PR #13; do not merge without staging acceptance.

## Mandatory PRE-FLIGHT (operator records evidence)
1. Confirm current `main` HEAD and production Cloudflare deployment SHA; verify they refer to the intended rollback baseline. A GitHub commit alone is NOT a DB restore point.
2. Confirm Cloudflare Pages project, production branch mapping, custom domains and account permissions. Record prior deployment ID and verify dashboard offers rollback to that deployment.
3. Identify Neon project, branch, database and full database endpoint used by **Production**; confirm Preview and Staging use different credentials/branches and cannot write to Production.
4. Create and verify a Neon data restore point (PITR/branch/snapshot depending on the Neon plan), record branch ID and retention time, and perform a non-destructive restore rehearsal into a **separate branch**. Never point users at the restored branch during a rehearsal.
5. Verify counts/hash or other agreed read-only checks for `users`, `questions`, `exams`, `results`, and the import tables (if they already exist). Export a protected backup under approved storage, not the source repository. No plaintext DB URLs, tokens or personal data in Git.
6. Apply `migrations/20261023_verified_word_import.sql` on **isolated Neon staging** only, after staging backup. Do not rerun `database-schema.sql` on Production.
7. Test authenticated full path: real DOCX with OMML equations in stem, options A-D and answers -> Cloudflare API -> Neon staging -> GET questions -> bank & student exam -> grading -> DOCX editable Word Equation. Test duplicates, failures, rollback and R2 image handling.
8. Obtain sign-off for staging test evidence, migration plan, downtime contingency, data reconciliation and monitored production release.

## Controlled production deployment
1. Recheck `main` and production HEAD before merge. Keep the baseline branch unchanged.
2. Migrate Production database **only after verified backup and compatible rollback strategy**, using audited migration SQL. Apply additive schema with scoped privilege; confirm no unintended schema/data changes.
3. Merge the approved PRs through reviews / required CI; avoid force-push to `main`.
4. Observe Cloudflare Production rollout and smoke-test user login, bank, import, render, student exam, grading, Word export. Avoid importing unverified DOCX.
5. Record release SHA, Cloudflare deployment ID, Neon backup/branch ID, migration version and exact times.

## SEV1 rollback / incident response
1. Freeze further deploys and Import Word writes; preserve logs, timestamps and batch IDs.
2. Recover serving application by rolling back Cloudflare Pages to the **recorded last known-good PRODUCTION deployment**, not an arbitrary preview URL; verify domain and app health.
3. Revert the faulty GitHub merge with a **new revert commit/PR** on `main` (do not rewrite history). Prevent automatic redeploy of the bad commit.
4. Keep newly-added import tables and newly-written records by default; do not run `DROP TABLE` or blanket database restore during an app-only rollback.
5. For a data/schema incident, choose selective forward-fix or data restoration after comparing the restore candidate with live writes since the backup. Do NOT blindly PITR the production branch: new exam results, accounts and answers could be lost. Restore to isolated Neon branch first, reconcile and obtain explicit approval before switching any endpoint.
6. Validate all critical services and data totals after rollback. Document incident cause and remediation.

## Rollback readiness acceptance (all required)
- [x] Verified pre-release Git commit and baseline successful checks.
- [x] Created an unmodified backup source branch from that commit.
- [ ] Verified actual Cloudflare production deployment ID and completed restore rehearsal.
- [ ] Verified independent Neon staging credentials and production separation.
- [ ] Verified Neon production restore point and rehearsed restore to new branch.
- [ ] End-to-end import, persisted read-back, grading and Word export passed against staging.
- [ ] Evidence attached; deployment and rollback approved.

**NO-GO** for production until all unchecked items are evidenced. Git rollback does not automatically restore database state.