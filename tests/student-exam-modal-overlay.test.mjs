import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/style.css', 'utf8');
const html = readFileSync('public/components/tab-exam.html', 'utf8');
const modal = readFileSync('public/components/modal-container.html', 'utf8');

test('student background must not override positioning of every exam child', () => {
  assert.doesNotMatch(
    css,
    /#exam-interface\.student-background-active\s*>\s*\*\s*\{[^}]*position\s*:\s*relative/s
  );
});

test('fullscreen enforcer remains a fixed full-screen overlay', () => {
  assert.match(
    html,
    /id="exam-fullscreen-enforcer"[^>]*class="[^"]*fixed[^"]*inset-0[^"]*z-\[999999\]/
  );
});

test('student settings remains a fixed full-screen modal', () => {
  assert.match(
    html,
    /id="student-settings-modal"[^>]*class="[^"]*fixed[^"]*inset-0/
  );
});

test('global confirmation modal container remains a fixed full-screen layer', () => {
  assert.match(
    modal,
    /id="modal-container"[^>]*class="[^"]*fixed[^"]*inset-0[^"]*z-\[100\]/
  );
});
