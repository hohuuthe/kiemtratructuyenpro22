// Cloudflare Pages runs independently from GitHub-hosted Actions.
// On this PR's preview branch, publish a small test report to diagnose CI failures.
// On main/other branches, a failed test blocks the production build.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const checks = [
  ['javascript_syntax', ['--check', 'src/main.js']],
  ['exam_integrity', ['--import', 'tsx', '--test', 'tests/exam-critical-integrity.test.ts']],
  ['question_pool', ['--import', 'tsx', '--test', 'tests/exam-question-pool-validity.test.ts']],
  ['typescript', ['node_modules/typescript/bin/tsc', '--noEmit']]
];
const results = [];
for (const [name, args] of checks) {
  const started = Date.now();
  const run = spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 240000, maxBuffer: 12 * 1024 * 1024, env: process.env
  });
  const output = String(run.stdout || '') + '\n' + String(run.stderr || '');
  const relevant = output.split(/\r?\n/).filter(line =>
    /^\s*(not ok\b|# (?:tests|pass|fail|duration_ms)|error TS\d+|\S+\.tsx?\(\d+,\d+\): error TS\d+|Error \[|Error:|AssertionError|FAIL\b|npm ERR!|ERR_)/i.test(line)
  ).slice(0, 45);
  const ok = run.status === 0 && !run.error;
  results.push({ name, ok, exitCode: run.status, error: run.error?.message || null,
    elapsedMs: Date.now() - started, diagnostics: relevant,
    // Preview-only diagnostic; test output from this repository contains no credentials.
    failureOutput: ok ? undefined : output.slice(-6000) });
  process.stdout.write('[exam-build] ' + name + ': ' + (ok ? 'PASS' : 'FAIL') + '\n');
  if (!ok) process.stderr.write('[exam-build] ' + name + ' failed: ' + relevant.join(' | ').slice(0, 3200) + '\n');
}

const branch = process.env.CF_PAGES_BRANCH || '';
const diagnosticPreview = branch === 'fix/student-exam-fast-loading-status-20261110';
const allPassed = results.every(x => x.ok);
if (diagnosticPreview) {
  mkdirSync('public', { recursive: true });
  writeFileSync('public/exam-release-preview-check.json',
    JSON.stringify({ branch, commit: process.env.CF_PAGES_COMMIT_SHA || '',
      allPassed, checks: results }, null, 2) + '\n');
}
if (!allPassed && !diagnosticPreview) {
  console.error('EXAM RELEASE GATE FAILED: production build blocked.');
  process.exit(1);
}
