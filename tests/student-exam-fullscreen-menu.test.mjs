import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('global mobile menu is uniquely identifiable without changing its existing click handler', () => {
  assert.match(html, /<button id="app-mobile-menu-toggle" onclick="toggleMobileSidebar\(\)" type="button"/);
  assert.equal((html.match(/id="app-mobile-menu-toggle"/g) || []).length, 1);
});

test('body fullscreen during exam READY and ACTIVE hides the global menu and sidebar', () => {
  for (const selector of [
    'body:fullscreen #app-mobile-menu-toggle',
    'body:-webkit-full-screen #app-mobile-menu-toggle',
    'body:fullscreen #app-sidebar',
    'body:-webkit-full-screen #app-sidebar',
    'body:fullscreen #sidebar-backdrop',
    'body:-webkit-full-screen #sidebar-backdrop'
  ]) {
    assert.ok(css.includes(selector), `Missing fullscreen selector: ${selector}`);
  }
  assert.match(css, /body:-webkit-full-screen #sidebar-backdrop\s*\{\s*display:\s*none !important;/);
  assert.doesNotMatch(css, /body:fullscreen #question-nav/);
});

test('fullscreen prestart retains its body target and active exams retain the question workspace', () => {
  assert.match(main, /awaitingAuthoritativeStart === true\s*\? document\.body/);
  assert.match(main, /: \(document\.getElementById\('exam-interface'\) \|\| document\.documentElement\)/);
  assert.match(html, /id="app-header"/);
});


test('active student fullscreen covers the viewport without black gutters, preserving READY and question navigation', () => {
  const brandingCss = readFileSync(new URL('../public/header-branding.css', import.meta.url), 'utf8');
  const fullScreenRule = css.match(/#exam-interface:fullscreen,\s*#exam-interface:-webkit-full-screen\s*\{([^}]*)\}/)?.[1];
  assert.ok(fullScreenRule, 'The active exam root needs an explicit viewport-filling fullscreen rule');
  for (const declaration of [
    'position: fixed !important',
    'inset: 0 !important',
    'width: 100vw !important',
    'height: 100dvh !important',
    'margin: 0 !important',
    'padding: 0 !important',
    'border-radius: 0 !important',
    'overflow-x: hidden !important',
    'background-color: #f8fafc !important'
  ]) {
    assert.ok(fullScreenRule.includes(declaration), 'Missing fullscreen edge-to-edge property: ' + declaration);
  }
  assert.match(css, /#exam-interface:fullscreen::backdrop,\s*#exam-interface:-webkit-full-screen::backdrop\s*\{\s*background-color:\s*#f8fafc !important/);
  assert.match(brandingCss, /#exam-interface:fullscreen\s*>\s*#exam-header-branding/);
  assert.match(brandingCss, /#exam-interface:-webkit-full-screen\s*>\s*#exam-header-branding/);
  assert.match(brandingCss, /padding-top:\s*max\(5px,\s*env\(safe-area-inset-top,\s*0px\)\)/);
  assert.doesNotMatch(fullScreenRule, /#question-nav|body:fullscreen|#app-sidebar/);
});
