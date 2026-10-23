import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const manager=read('public/components/tab-exams.html');
const editor=read('public/components/tab-exam-editor.html');
const app=read('src/main.js');
const index=read('index.html');
const ids=s=>[...s.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
test('Management contains table, not exam editor form',()=>{
 assert.ok(manager.includes('exam-configs-table-body'));
 assert.ok(manager.includes('search-exam-config-table'));
 for(const p of ['exam-lesson-selection','new-exam-name','exam-config-time','saveExamConfig()'])assert.ok(!manager.includes(p),p);
});
test('Editor retains original fields and existing save action',()=>{
 for(const id of ['exam-config-name','new-exam-name','exam-config-time','exam-lesson-selection','exam-config-mode','exam-config-ai-prompt'])assert.ok(ids(editor).includes(id),id);
 assert.ok(editor.includes('onclick="saveExamConfig()"'));
 assert.deepEqual(ids(manager).filter(id=>ids(editor).includes(id)),[]);
});
test('Nav, authorization and load flow target new editor tab',()=>{
 assert.ok(index.includes('data-sidebar-tab="exam-editor"'));
 assert.ok(index.includes('id="tab-exam-editor"'));
 assert.ok(app.includes("'questions', 'exams', 'exam-editor'"));
 assert.ok(app.includes("tab === 'questions' || tab === 'exams' || tab === 'exam-editor'"));
 assert.ok(app.includes('await openExamEditorTab({newExam:false});'));
 assert.ok(app.includes('window.startNewExamConfig = async function startNewExamConfig()'));
 assert.ok(app.includes('if (newExam) resetExamPanelToDefault();'));
 assert.ok(app.includes('if (examEditorInitialized) {'));
});
test('Business save, export and delete functions still exist',()=>{
 for(const fn of ['window.saveExamConfig = async function saveExamConfig','saveExamConfigToDB()','window.deleteExamConfig = async function deleteExamConfig','window.openExportDocxModal = async function openExportDocxModal'])assert.ok(app.includes(fn),fn);
});
