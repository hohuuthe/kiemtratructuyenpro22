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
