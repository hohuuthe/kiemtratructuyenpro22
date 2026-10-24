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
test('Exam editor uses the exact new tab name without changing its tab identifier',()=>{
 const editorButton = index.match(/<button[^>]*data-sidebar-tab="exam-editor"[\s\S]*?<\/button>/)?.[0] || '';
 assert.match(editorButton, /<span class="truncate">Tạo, sửa đề thi<\/span>/);
 assert.ok(editor.includes('<h3 class="font-bold text-gray-800 text-lg">📝 Tạo, sửa đề thi</h3>'));
 assert.ok(!index.includes('QL Tạo/sửa đề thi'));
 assert.ok(!editor.includes('QL Tạo/sửa đề thi'));
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

test('Server-side exam confidentiality, JWT expiry and cross-owner write guards',async()=>{
 const security=read('functions/api/exam/security.ts');
 for(const name of ['redactExamForPublic','makeGradeSessionConfig','accessCodeMatches','isExamOwner'])assert.ok(security.includes('function '+name),name);
 assert.ok(security.includes("'ai_grading_key'") === false, 'AI key must not be in public/session field allowlists');
 assert.ok(security.includes('const publicFields = ['));
 assert.ok(security.includes('const gradeFields = ['));
 const api=read('functions/api/exams.ts'), generate=read('functions/api/exam/generate.ts');
 const questions=read('functions/api/questions.ts'), login=read('functions/api/auth/login.ts');
 const utils=read('functions/api/exam/utils.ts');
 assert.ok(api.includes('redactExamForPublic'));
 assert.ok(generate.includes('accessCodeMatches(submittedAccessCode, dbExam.mabaomatdethi)'));
 assert.ok(generate.includes('makeGradeSessionConfig(activeExamConfig)'));
 assert.ok(questions.includes('WHERE questions.creator_id = excluded.creator_id'));
 assert.ok(login.includes('safeAccount'));
 assert.ok(login.includes('signAuthSession(account,'));
 assert.ok(utils.includes('exp:now + 12*3600'));
 assert.ok(utils.includes('Number(claims.exp) <= now'));
});

test('Security invariants: tenant routing, account secrecy and atomic exam revisions',()=>{
 const adapter=read('functions/api/neon-adapter.ts');
 const exams=read('functions/api/exams.ts');
 const accounts=read('functions/api/accounts.ts');
 const drafts=read('src/exam-editor-safety.js');
 const hostMap=read('src/tenant-host-map.ts');
 assert.ok(adapter.includes('resolveTenantFromRequest(request, env)'));
 assert.ok(hostMap.includes('TENANT_HOST_MAP'));
 assert.ok(hostMap.includes('Hostname is not registered'));
 assert.ok(!adapter.includes('extractTenantSlug(req)'));
 assert.ok(!accounts.includes('SELECT accounts.id, accounts.user_id, accounts.username, accounts.password'));
 assert.ok(exams.includes('expected_updated_at'));
 assert.ok(exams.includes('updated_at IS NOT DISTINCT FROM ?'));
 assert.ok(exams.includes('EXAM_VERSION_CONFLICT'));
 assert.ok(exams.includes('DUPLICATE_EXAM_NAME'));
 assert.ok(drafts.includes("updatedAt: text(row.updated_at ?? row.updatedAt)"));
 assert.ok(app.includes('expected_updated_at: draft.id ?'));
});

test('Authentication is bound to live account state and privilege cannot rely on cached claims',()=>{
 const utils=read('functions/api/exam/utils.ts');
 const login=read('functions/api/auth/login.ts');
 for(const p of ["export async function verifyAuthSession(","accountProof(account, secret, tenantKey)","isLiveAccount(account)","decoded.tokenType !== 'auth'","account.role","account.password","profile_expiry_date"])assert.ok(utils.includes(p),p);
 assert.ok(login.includes('signAuthSession(account,'));
 assert.ok(utils.includes("const actual = await accountProof(account, secret, String(db.connectionUrl || ''))"));
 for(const path of ['functions/api/exams.ts','functions/api/questions.ts','functions/api/results.ts','functions/api/accounts.ts','functions/api/users.ts','functions/api/teacher-classes.ts']) {
   const t=read(path);
   assert.ok(t.includes('verifyAuthSession('),path);
   assert.ok(!t.includes('await verifyJWT('),path);
 }
});
test('Results no longer authorize ambiguous student names or exam-name ownership',()=>{
 const result=read('functions/api/results.ts');
 assert.ok(!result.includes('r.exam_name = e.name'));
 assert.ok(!result.includes('row.student_name === user.full_name'));
 assert.ok(!result.includes('r.user_id IS NULL AND r.student_name = ?'));
 assert.ok(result.includes('String(row.user_id) === String(user.id)'));
});
test('Two-client conflict SQL has atomic compare-and-swap',()=>{
 const exams=read('functions/api/exams.ts');
 assert.ok(exams.includes("updated_at IS NOT DISTINCT FROM ?"));
 assert.ok(exams.includes('updateResult.meta?.changes !== 1'));
 assert.ok(exams.includes('code:\'EXAM_VERSION_CONFLICT\''));
 assert.ok(app.includes('expected_updated_at: draft.id ?'));
});
