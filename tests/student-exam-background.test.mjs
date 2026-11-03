import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/components/tab-exam.html', 'utf8');
const main = readFileSync('src/main.js', 'utf8');
const css = readFileSync('src/style.css', 'utf8');
const moduleSource = readFileSync('src/student-exam-background.js', 'utf8');

test('student exam exposes a background image control beside fullscreen controls', () => {
  assert.match(html, /id="btn-student-exam-background"/);
  assert.match(html, /id="student-exam-background-input"/);
  assert.match(html, /accept="image\/\*"/);
  assert.match(html, /openStudentExamBackgroundPicker\(\)/);
});

test('background module persists, restores and applies the image to exam interface', () => {
  assert.match(moduleSource, /student_exam_background_v1/);
  assert.match(moduleSource, /localStorage\.setItem/);
  assert.match(moduleSource, /student-background-active/);
  assert.match(moduleSource, /--student-exam-background-image/);
});

test('background picker is exempt from anti-cheat while native file chooser is open', () => {
  assert.match(main, /window\.studentBackgroundPickerActive/);
  assert.match(moduleSource, /window\.intentionalFullscreenExit = true/);
  assert.match(moduleSource, /enterExamFullscreen/);
});

test('background styling works on normal and fullscreen exam interface', () => {
  assert.match(css, /#exam-interface\.student-background-active/);
  assert.match(css, /:fullscreen/);
  assert.match(css, /background-image:.*--student-exam-background-image/s);
});
