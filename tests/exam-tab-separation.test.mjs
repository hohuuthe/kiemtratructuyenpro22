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
 const openEditor = app.slice(app.indexOf('async function openExamEditorTab('), app.indexOf('window.startNewExamConfig = async function'));
 assert.match(openEditor, /if\s*\(newExam\)\s*\{[^}]*\+\+examConfigLoadSeq;[^}]*resetExamPanelToDefault\(\);/s,
   'Tạo mới must cancel pending requests and reset the configuration');
 assert.ok(app.includes('if (examEditorInitialized) {'));
});
test('Business save, export and delete functions still exist',()=>{
 for(const fn of ['window.saveExamConfig = async function saveExamConfig','saveExamConfigToDB(draft, expected)','window.deleteExamConfig = async function deleteExamConfig','window.openExportDocxModal = async function openExportDocxModal'])assert.ok(app.includes(fn),fn);
});

test('Account transition clears editor, lesson checkboxes and cached exam list',()=>{
 const login = app.slice(app.indexOf('async function handleSuccessfulLogin()'), app.indexOf('function updateSidebarVisibility()'));
 const logout = app.slice(app.indexOf('async function adminLogout()'), app.indexOf('function initProtectedTabs()'));
 const clear = app.slice(app.indexOf('function invalidateExamEditorSession()'), app.indexOf('window.openExamEditorTab = openExamEditorTab'));
 assert.ok(login.includes('invalidateExamEditorSession();'), 'login clears old account');
 assert.ok(logout.includes('invalidateExamEditorSession();'), 'logout clears old account');
 for (const statement of ['authDataGeneration += 1','examEditorInitialized = false','examEditorInitializing = null','window.allExamConfigsList = []',"lessonList.innerHTML = ''",'resetExamPanelToDefault();'])
   assert.ok(clear.includes(statement), statement);
});
test('Late private fetches cannot overwrite state after teacher switches or new exam creation',()=>{
 for(const guard of [
   'generation !== authDataGeneration || !(isAdminLoggedIn || isTeacherLoggedIn)',
   'requestSeq !== examNamesRequestSeq',
   'requestSeq !== examConfigLoadSeq',
   'if (generation !== authDataGeneration) return;',
   '++examConfigLoadSeq; // Cancel any in-flight Nạp/selection response.'
 ]) assert.ok(app.includes(guard), guard);
});

test('Exam configuration isolation, UUID identity and backend failure safety', async () => {
 const {createEmptyExamDraft,mapStoredExamToDraft,resolveExamSaveIdentity} = await import('../src/exam-editor-safety.js');
 const teacher={id:'teacher-A',full_name:'Teacher A'};
 const draftA=mapStoredExamToDraft({id:'A',name:'Exam A',creator_id:'teacher-A',tf4_points:'{"1":0.25,"2":0.75}',selected_lessons:'["lesson-A"]',max_attempts:8,ai_prompt:'private-A',count_41:10}, {currentUser:teacher});
 const draftB=mapStoredExamToDraft({id:'B',name:'Exam B',creator_id:'teacher-B',count_41:5},{currentUser:teacher});
 assert.equal(draftA.id,'A'); assert.equal(draftB.id,'B');
 assert.deepEqual(draftB.selectedLessons,[]); assert.equal(draftB.aiPrompt,'');
 assert.equal(draftB.maxAttempts,0); assert.equal(draftB.count41,5);
 assert.deepEqual(draftB.tf4Points,{1:0.25,2:0.5,3:0.75,4:1});
 assert.notEqual(draftA.tf4Points,draftB.tf4Points);
 const fresh=createEmptyExamDraft({id:'teacher-C',full_name:'Teacher C'});
 assert.equal(fresh.id,''); assert.equal(fresh.creatorId,'teacher-C');
 assert.equal(fresh.maxAttempts,0);
 assert.equal(resolveExamSaveIdentity({selectedId:'B',draftId:'A',draftName:'Exam A'}).ok,false);
 assert.equal(resolveExamSaveIdentity({newName:'New B',draftId:'A'}).ok,false);
 assert.equal(resolveExamSaveIdentity({selectedId:'B',draftId:'B',draftName:'Exam B'}).intent,'update');
 assert.equal(resolveExamSaveIdentity({newName:'New B',draftId:''}).intent,'create');
 const api=read('functions/api/exams.ts');
 assert.ok(!api.includes('const fallbackExams = ['));
 assert.ok(api.includes('crypto.randomUUID()'));
 assert.ok(app.includes('resolveExamSaveIdentity({'));
 assert.ok(app.includes('examSavePending = true'));
 assert.ok(app.includes('saveGeneration !== authDataGeneration'));
 assert.ok(app.includes('structuredClone(examConfig)'));
 assert.ok(!app.includes('const parsedId = parseInt(examConfig.id, 10)'));
});
