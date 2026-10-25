import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HELP_GUIDES } from '../src/help-center-content.js';
import { helpRole, helpVisibleSectionIds } from '../src/help-center.js';

test('guest and unknown users are fail-closed', () => {
  assert.equal(helpRole(), 'guest');
  assert.equal(helpRole({user:{id:'unknown',role:'user'}}), 'guest');
  assert.deepEqual(helpVisibleSectionIds('guest'), []);
});
test('role resolution follows login audience and role', () => {
  assert.equal(helpRole({user:{id:'1',role:'admin',target_audience:'Giáo viên'},isAdmin:true}), 'admin');
  assert.equal(helpRole({user:{id:'2',role:'user',target_audience:'Giáo viên'},isTeacher:true}), 'teacher');
  assert.equal(helpRole({user:{id:'3',role:'user',target_audience:'Học sinh'}}), 'student');
  assert.equal(helpRole({user:{id:'4',role:'teacher'}}), 'teacher');
});
test('three independent guide sets with unique topics', () => {
  const ids = new Set();
  for (const role of ['admin','teacher','student']) {
    const g = HELP_GUIDES[role];
    assert.ok(g.intro.length > 100);
    assert.ok(g.sections.length >= 8);
    assert.ok(g.faqs.length >= 5);
    assert.ok(g.links.length >= 2);
    for (const section of g.sections) {
      assert.ok(section.steps.length >= 3, section.id);
      assert.ok(!ids.has(section.id), section.id);
      ids.add(section.id);
    }
    assert.deepEqual(helpVisibleSectionIds(role),g.sections.map(s=>s.id));
  }
});
test('student has only student entry points and no admin actions', () => {
  assert.deepEqual(HELP_GUIDES.student.links.map(l=>l[0]),['exam','ranking']);
  assert.ok(!HELP_GUIDES.teacher.links.some(l=>['accounts','settings','teacher-assignment'].includes(l[0])));
  assert.ok(HELP_GUIDES.admin.links.some(l=>l[0]==='accounts'));
});
test('role isolation: template has no cross-role content', () => {
  const html = readFileSync(new URL('../public/components/tab-help.html',import.meta.url),'utf8');
  assert.match(html,/id="help-center-root"/);
  assert.doesNotMatch(html, /Dành cho Giáo viên|Dành cho Thí sinh|Quản trị viên/);
  const main = readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/renderRoleHelp\(helpRoot, \{ user: currentUser/);
  assert.match(main,/renderRoleHelp\(helpRoot, \{ user: null \}/);
  assert.match(main,/if \(tabName === 'help'\)/);
  assert.match(main,/attachRoleHelpInteractions\(helpRoot\)/);
});
