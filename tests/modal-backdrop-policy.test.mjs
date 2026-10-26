import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isModalBackdropTarget, isModalSurface } from '../src/modal-behavior.js';

const read = path => readFileSync(path, 'utf8');

test('backdrop predicate is true only for the overlay or its descendants', () => {
  const modal = { contains: node => node?.isInModal === true };
  const backdrop = { isInModal: true };
  const child = { closest: selector => selector.includes('modal-overlay') ? backdrop : null };
  const unrelated = { closest: () => ({ isInModal: false }) };
  assert.equal(isModalBackdropTarget(modal, modal), true);
  assert.equal(isModalBackdropTarget(child, modal), true);
  assert.equal(isModalBackdropTarget(unrelated, modal), false);
  assert.equal(isModalBackdropTarget(null, modal), false);
});

test('ordinary fixed banners are not treated as modal surfaces', () => {
  const element = classes => ({
    tagName: 'DIV', id: 'floating-exam-timer',
    classList: { contains: name => classes.includes(name) }
  });
  assert.equal(isModalSurface(element(['fixed','top-3'])), false);
  assert.equal(isModalSurface(element(['fixed','inset-0'])), true);
});

test('core, account, user, import, document modals have no outside-close handler', () => {
  for (const file of [
    'public/components/modal-container.html',
    'public/components/account-modal.html',
    'public/components/user-modal.html',
    'public/components/tab-accounts.html',
    'public/components/tab-users.html'
  ]) {
    const html=read(file);
    assert.doesNotMatch(html, /class="modal-overlay[^"]*"\s+onclick=/);
  }
  assert.doesNotMatch(read('src/document-links-ui.js'),
    /documents-modal'\)\?\.addEventListener\('click'[\s\S]*?\bclose\(\)/);
});

test('dynamic dialogs do not dismiss on outside clicks', () => {
  const main=read('src/main.js');
  assert.doesNotMatch(main, /<div class="modal-overlay absolute inset-0" onclick=/);
  assert.doesNotMatch(main, /<div class="absolute inset-0" onclick="closeSecondaryModal/);
  assert.doesNotMatch(main, /if \(bgOverlay\) bgOverlay\.onclick = closeZoomModal/);
  assert.doesNotMatch(main, /id="qr-modal-backdrop" onclick=/);
  assert.doesNotMatch(main, /id="mobile-actions-backdrop" onclick=/);
});

test('global modal guard loads and traps outside clicks, Escape and background scroll', () => {
  const index=read('index.html');
  const logic=read('src/modal-behavior.js');
  const css=read('src/style.css');
  assert.match(index, /src\/modal-behavior\.js/);
  assert.match(logic, /stopImmediatePropagation/);
  assert.match(logic, /event\.key === 'Escape'/);
  assert.match(logic, /MutationObserver/);
  assert.match(logic, /focusInside\(top\)/);
  assert.match(css, /html\.kttt-modal-open, body\.kttt-modal-open/);
});
