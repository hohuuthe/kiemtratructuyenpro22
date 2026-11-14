import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { studentExamHeaderState } from '../src/student-exam-header-branding.js';

const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');

test('student fullscreen has 3 independent header modes with safe default', () => {
  assert.equal(studentExamHeaderState({}).mode,'text');
  assert.equal(studentExamHeaderState({examHeaderDisplayMode:'banner'}).mode,'banner');
  assert.equal(studentExamHeaderState({examHeaderDisplayMode:'both'}).mode,'both');
  assert.equal(studentExamHeaderState({examHeaderDisplayMode:'unknown'}).mode,'text');
});

test('full screen branding reuses app banner with text fallback', () => {
  const settings = {
    appTitle:'THPT LÊ HOÀN',
    examHeaderDisplayMode:'banner',
    headerBannerUrl:'https://cdn.example.test/banner.webp',
    headerBannerTabletUrl:'https://cdn.example.test/tablet.webp',
    headerBannerMobileUrl:'https://cdn.example.test/mobile.webp'
  };
  const branded = studentExamHeaderState(settings);
  assert.equal(branded.hasBanner,true);
  assert.equal(branded.showTitle,false);
  assert.equal(branded.title,'THPT LÊ HOÀN');
  assert.equal(branded.brand.mobileUrl,settings.headerBannerMobileUrl);
  assert.equal(branded.brand.tabletUrl,settings.headerBannerTabletUrl);
  const missing = studentExamHeaderState({...settings, headerBannerUrl:''});
  assert.equal(missing.showTitle,true);
  assert.equal(missing.hasBanner,false);
  assert.equal(studentExamHeaderState({...settings,examHeaderDisplayMode:'both'}).showTitle,true);
});

test('student branding uses actual exam fullscreen root, never page header', () => {
  const ui=read('src/student-exam-header-branding.js');
  const exam=read('public/components/tab-exam.html');
  assert.match(ui,/document\.fullscreenElement !== root/);
  assert.match(ui,/root\.classList\.contains\('hidden'\)/);
  assert.match(ui,/document\.addEventListener\('fullscreenchange'/);
  assert.match(ui,/image\.onerror =/);
  assert.match(ui,/image\.src = brand\.url/);
  assert.match(exam,/id="exam-header-branding"/);
  assert.match(exam,/id="exam-header-branding-img"/);
  assert.match(read('public/header-branding.css'),/max-height:54px/);
});

test('admin controls and both APIs persist the independent mode for each tenant', () => {
  const form=read('public/components/tab-settings.html');
  const control=read('src/header-branding-ui.js');
  const api=read('functions/api/header-banner.ts');
  const bootstrap=read('functions/api/bootstrap.ts');
  const node=read('server.ts');
  const main=read('src/main.js');
  assert.match(form,/id="settings-exam-header-mode"/);
  assert.match(control,/exam_header_display_mode: headerMode/);
  assert.match(control,/examHeaderDisplayMode: committed\.exam_header_display_mode/);
  assert.match(api,/exam_header_display_mode TEXT NOT NULL DEFAULT/);
  assert.match(api,/exam_header_display_mode = \?/);
  assert.match(api,/checkIsAdmin\(user\)/);
  assert.match(bootstrap,/exam_header_display_mode: examHeaderMode/);
  assert.match(node,/exam_header_display_mode:examHeaderMode/);
  assert.match(main,/examHeaderDisplayMode:d\.exam_header_display_mode/);
  assert.match(read('migrations/20261114_header_banner_branding.sql'),/ADD COLUMN IF NOT EXISTS exam_header_display_mode/);
});
