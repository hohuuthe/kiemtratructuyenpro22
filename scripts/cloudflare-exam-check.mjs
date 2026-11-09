// Cloudflare Pages runs independently from GitHub-hosted Actions.
// On this PR's preview branch, publish a small test report to diagnose CI failures.
// On main/other branches, a failed test blocks the production build.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

// Bundle TS-only test entrypoints with esbuild. The repo includes both
// exam-grading-core.js and a TS re-export shim of the same basename. The tsx
// loader redirects .js imports to that shim, producing a false missing-export
// error before any test executes. Bundling preserves the actual .js implementation.
const testDir = mkdtempSync(join(tmpdir(), 'exam-release-'));
const compileTest = (source, name) => {
  const output = join(testDir, name + '.mjs');
  buildSync({ entryPoints: [source], outfile: output, bundle: true,
    platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  return output;
};
const checks = [
  ['javascript_syntax', ['--check', 'src/main.js']],
  ['exam_integrity', ['--test', compileTest('tests/exam-critical-integrity.test.ts', 'integrity')]],
  ['question_pool', ['--test', compileTest('tests/exam-question-pool-validity.test.ts', 'pool')]],
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

rmSync(testDir, { recursive: true, force: true });

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
