# Durable essay grading and recovery

## Invariants

Submission is persisted before Gemini. The idempotency key is a signed exam
session token hash, not student name or exam title. Pending essays have NULL
final score, never a fabricated 0. Each worker holds a DB lease and checkpoints
completed questions with compare-and-swap guards; teacher grade changes invalidate
the lease. Database write failures do not return a fake success response.

AI cannot guarantee successful grading for every answer; provider outages, expired
keys, quota, ambiguous answers or invalid score payloads remain pending or require
human grading. States: completed, pending, processing, retry_pending, waiting_key,
manual_required. Historical rows default to completed.

## Configuring automatic recovery in Cloudflare Pages

Cloudflare Pages Functions do not on their own run scheduled work.
Set a random ESSAY_RETRY_CRON_SECRET of at least 24 characters as an environment
secret in Cloudflare Pages and as a GitHub Actions repository secret with the
same name. In GitHub Actions repository variables, configure ESSAY_RETRY_URLS
as one fully qualified HTTPS URL per tenant hostname; every URL must end with
/api/exam/retry-pending. Confirm GitHub runners are enabled and jobs succeed.

A cron job is configured to run every five minutes and requests at most two
eligible, tenant-scoped attempts at a time. If runners are disabled, pending
attempts are still recoverable when a student revisits their results or a
teacher initiates a retry.

## Release checks

Before merge: node --test tests/durable-essay-grading.test.mjs
tests/essay-key-pool.test.mjs; npm run lint; npm run build.
On a disposable Neon tenant, test invalid keys, quotas, timeouts, duplicate
submissions, concurrent workers, manual edits, access permissions, status
visibility, and preserving existing results. Confirm no student-facing API
exposes raw keys or private grading rubrics.

Note: standalone Express grading still needs parity with the Cloudflare Pages
implementation. Keep this PR unmerged until the supported production target
has passed integration tests.

## Security gate added for PR #54

- Both the Cloudflare Pages and Express submit endpoints require all signed
  original question IDs to resolve to valid grading sources. A missing
  objective answer key is a grading error, **not a score of zero**.
- Signed student account identity must match the active authenticated session
  when submitting. Unauthenticated attempts are never assigned a browser-supplied
  user ID.
- The live `exam_configs.show_score/show_details` fields govern the submit
  response and replay response. Internal question keys, hidden answer images,
  and private grading snapshots must not reach the browser.
- Teachers may only query results for exam IDs they own; administrators retain
  their configured oversight privileges. A student views personal results
  through `/api/results/me`, not the legacy roster endpoint.
- New session tokens include `studentUserId`; an in-progress legacy token
  issued before this security change may be rejected. Release during a period
  without active exams; do not change session-binding policy mid-exam.

## Neon staging evidence (2026-10-28)

A separate QA branch named `qa-essay-pr54-20261028` was created from the
`luu_csdl` backup branch. No production table was modified. The QA branch
was checked for result schema, idempotency unique index and grading queue index.
A single transactional **temporary-table** test confirmed:

1. A repeated signed-token hash produces one attempt.
2. Worker B does not claim a record leased to worker A.
3. A manual override to `completed` prevents worker A's stale checkpoint
   from replacing the manual score.

This is **database-level evidence only**, not full API concurrency, live Gemini
or multi-tenant HTTP routing verification.

## Mandatory deployment procedure (not yet passed)

1. Restore operational GitHub Actions runners and confirm a successful
   `npm ci`, `node --test`, `npm run lint`, `npm run build` run on
   the exact candidate commit. A GitHub Actions job failing with **no steps**
   is NOT a valid application test result.
2. On a disposable QA tenant, run two independent browsers submitting the
   same signed session token concurrently, verify exactly one `results` row,
   then retry HTTP 429, invalid keys, timeout, image-only answers and teacher
   overrides. Verify real Gemini results and correct totals in Neon.
3. Test two explicitly mapped hostnames with independent Neon databases.
   Confirm cookies/JWTs and result IDs from tenant A never authorize tenant B.
4. In GitHub Actions, configure `ESSAY_RETRY_URLS` with every tenant hostname
   and `ESSAY_RETRY_CRON_SECRET` secret; configure the identical secret in
   Cloudflare Pages environment. Verify the five-minute workflow succeeds
   with real `processed` counts, and produces a hard failure when unconfigured.
   Never publish or commit raw secrets.
5. Before release, take an explicit Neon database snapshot or named recovery
   branch of each production tenant. Record the main commit and previous
   Cloudflare Pages production deployment ID for rollback. Test restore
   on a disposable branch, never by overwriting a live database.
6. Deploy to Preview first. Test student submission, visibility policy,
   teacher updates, scheduled recovery and all tenants. Only after approval
   merge the PR and deploy Production. Smoke test each hostname, inspect
   4xx/5xx errors and pending grading backlog. Roll back the Cloudflare
   deployment to its previous revision if a new regression appears;
   avoid reverting schema/data without a separate, reviewed restore plan.

**Release state:** BLOCKED until CI, real Gemini, Preview API integration,
tenant isolation and Cloudflare secret/scheduler checks are positively verified.
