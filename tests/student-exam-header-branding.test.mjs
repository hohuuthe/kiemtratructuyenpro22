import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { studentExamHeaderState, applyStudentExamHeaderBranding } from '../src/student-exam-header-branding.js';
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');

test('fullscreen mode defaults to text and supports title/banner/both independently', () => {
  assert.equal(studentExamHeaderState({}).mode,'text');
  assert.equal(studentExamHeaderState({examHeaderDisplayMode:'banner'}).mode,'banner');
  assert.equal(studentExamHeaderState({examHeaderDisplayMode:'both'}).mode,'both');
  assert.equal(studentExamHeaderState({examHeaderDisplayMode:'invalid'}).mode,'text');
  const settings = {examHeaderDisplayMode:'banner',appTitle:'TRƯỜNG THPT',headerBannerUrl:'https://cdn.example.org/banner.webp'};
  assert.equal(studentExamHeaderState(settings,'school').hasBanner,true);
  assert.equal(studentExamHeaderState(settings,'school').showTitle,false);
  assert.equal(studentExamHeaderState({...settings,headerBannerUrl:''},'school').showTitle,true);
  assert.equal(studentExamHeaderState({...settings,examHeaderDisplayMode:'both'},'school').showTitle,true);
});

test('tenant banner scope is respected for school and online contest, without changing heading fallback',()=>{
  const settings={examHeaderDisplayMode:'banner',headerBannerScope:'contest',
    headerBannerUrl:'https://cdn.example.org/brand.png'};
  assert.equal(studentExamHeaderState(settings,'school').hasBanner,false);
  assert.equal(studentExamHeaderState(settings,'school').showTitle,true);
  assert.equal(studentExamHeaderState(settings,'contest').hasBanner,true);
  assert.equal(studentExamHeaderState({...settings,headerBannerScope:'both'},'school').hasBanner,true);
  assert.equal(studentExamHeaderState({...settings,headerBannerScope:'school'},'contest').hasBanner,false);
});

test('fullscreen root, image fallback and activation listener have no scoring/timing side effects',()=>{
  const source=read('src/student-exam-header-branding.js');
  assert.match(source,/document\.fullscreenElement === root/);
  assert.match(source,/root\.classList\.contains\('hidden'\)/);
  assert.match(source,/new MutationObserver/);
  assert.match(source,/document\.addEventListener\('fullscreenchange'/);
  assert.match(source,/image\.onerror/);
  assert.doesNotMatch(source,/submitExam|gradeExam|requestFullscreen\(|exitFullscreen\(/);
  const html=read('public/components/tab-exam.html');
  assert.match(html,/id="exam-header-branding"/);
  assert.match(html,/id="exam-header-branding-img"/);
  assert.match(read('public/header-branding.css'),/max-height:54px/);
});

test('Admin-only tenant update and public bootstrap carry independent fullscreen branding option',()=>{
  const form=read('public/components/tab-settings.html');
  const ui=read('src/header-branding-ui.js');
  const api=read('functions/api/header-banner.ts');
  const bootstrap=read('functions/api/bootstrap.ts');
  assert.match(form,/id="settings-exam-header-mode"/);
  assert.match(form,/id="settings-banner-scope"/);
  assert.match(ui,/exam_header_display_mode: headerMode/);
  assert.match(ui,/examHeaderDisplayMode: committed\.exam_header_display_mode/);
  assert.match(api,/checkIsAdmin\(user\)/);
  assert.match(api,/exam_header_display_mode TEXT NOT NULL DEFAULT/);
  assert.match(api,/exam_header_display_mode = \?/);
  assert.match(api,/requestedExamMode !== undefined/);
  assert.match(bootstrap,/exam_header_display_mode: examHeaderMode/);
  assert.match(read('migrations/20261114_header_banner_branding.sql'),/ADD COLUMN IF NOT EXISTS exam_header_display_mode/);
});

test('fullscreen branding never displays in normal page and shows only after activation',()=>{
  const previous=globalThis.document;
  const root={classList:{contains(v){return v==='hidden'&&root.isHidden;}},isHidden:true};
  const container={hidden:true},title={hidden:false,textContent:''};
  const image={hidden:true,complete:false,naturalWidth:0,src:'',alt:'',
    getAttribute(name){return name==='src'?this.src:null;},
    removeAttribute(name){if(name==='src')this.src='';}};
  const elems={'exam-interface':root,'exam-header-branding':container,
    'exam-header-branding-title':title,'exam-header-branding-img':image};
  globalThis.document={fullscreenElement:null,getElementById:id=>elems[id]||null};
  try {
    const config={appTitle:'TRƯỜNG THPT',examHeaderDisplayMode:'both',
      headerBannerUrl:'https://cdn.example.org/banner.webp',headerBannerScope:'both'};
    applyStudentExamHeaderBranding(config);
    assert.equal(container.hidden,true);
    globalThis.document.fullscreenElement=root;
    applyStudentExamHeaderBranding(config);
    assert.equal(container.hidden,true,'no header before exam activation');
    root.isHidden=false;
    applyStudentExamHeaderBranding(config);
    assert.equal(container.hidden,false);
    assert.equal(title.textContent,'TRƯỜNG THPT');
    image.onload();
    assert.equal(image.hidden,false);
    config.examHeaderDisplayMode='banner';
    image.complete=true;image.naturalWidth=1200;
    applyStudentExamHeaderBranding(config);
    assert.equal(title.hidden,true);
    image.onerror();
    assert.equal(title.hidden,false,'title fallback on missing banner');
    assert.equal(image.hidden,true);
    globalThis.document.fullscreenElement=null;
    applyStudentExamHeaderBranding(config);
    assert.equal(container.hidden,true);
  } finally {
    if(previous===undefined)delete globalThis.document;
    else globalThis.document=previous;
  }
});
