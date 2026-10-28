# KTTT Security integration: PR #54 on top of Production #57

## Recovery checkpoints (2026-10-28)
- Verified Production commit: `b97ce715fd63f1402ffc20b160a968b2a95eda4e`.
- Immutable-content GitHub recovery reference: `backup/production-b97ce715-20261028`.
- Neon project `dark-math-21442044`, default `production` (branch id `br-frosty-fire-az1km4ze`).
- Neon database recovery copy: `backup-before-pr54-integration-20261028` (branch id `br-solitary-base-azyzranp`, parent LSN `0/147B02E0`, snapshot timestamp `2026-10-28T06:55:14Z`).
- Neon manual snapshot attempt failed (snapshot quota exceeded); database branch copy is available. **The copy is point-in-time, not a continuously updated backup**.

## Integration requirements
1. Bring PR #54's fail-closed grading question-source checks, signed identity and live exam visibility into both Pages and Express.
2. Store submission before Gemini, idempotent attempt hash, lease/CAS updates, retry statuses and teacher override.
3. Add retry APIs, admin/teacher/student access checks, rate limits, 429/5xx handling and tenant isolation.
4. Preserve PR #57's browser-local Gemini grading key settings and existing manual grading UI.
5. Reconcile PR #54's modified files with newer Production changes; **do not replace src/main.js, server.ts, results APIs or grading API wholesale**.
6. Migrate on an independent QA Neon branch only, then test 2 tenants, concurrent submissions, score privacy, and failure recovery.
7. Run full `npm run lint`, `npm run build` and integration checks with actual successful GitHub Actions jobs. Production deployment requires separate approval and verified health.

## Rollback notes
- Source rollback: deploy commit `b97ce715fd63f1402ffc20b160a968b2a95eda4e` or branch `backup/production-b97ce715-20261028`.
- Database rollback: the separate Neon copy is an inspection/recovery point; restoring it could **overwrite newer students' exams/results**. Never restore production without an explicit data-reconciliation plan.
- Verify actual Cloudflare production deployment and CSDL routing before reverting anything.

Status: recovery references established; security integration not yet deployed.
