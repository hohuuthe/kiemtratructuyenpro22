import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOCUMENT_AUDIENCES,documentAudienceValues,documentActorRole,canManageDocument,canEditDocumentRow,canViewDocument,normalizeDocumentLinkInput,DocumentLinkInputError} from '../src/document-link-policy.js';
import {DOCUMENT_LINK_SCHEMA_STATEMENTS,ensureDocumentLinkSchema} from '../src/document-links-schema.js';
const admin={id:'a',role:'admin'};
const teacher={id:'t',role:'teacher'};
const teacher2={id:'t2',role:'teacher'};
const student={id:'s',role:'user',target_audience:'Học sinh'};
const row=(audience,creator='t')=>({id:'d',id_nguoi_tao:creator,doi_tuong_duoc_truy_cap:audience,hoat_dong:1});
test('role recognition and isolation',()=>{
 assert.equal(documentActorRole(null),'guest');
 assert.equal(documentActorRole(student),'student');
 assert.equal(documentActorRole(teacher),'teacher');
 assert.equal(documentActorRole(admin),'admin');
 assert.ok(canManageDocument(admin,row('student')));
 assert.ok(canManageDocument(teacher,row('student')));
 assert.ok(!canManageDocument(teacher2,row('student')));
 assert.ok(!canManageDocument(student));
 assert.ok(!canManageDocument(null));
});
test('every audience is server gated',()=>{
 const actors=[null,student,teacher,admin];
 const expected={public:[1,1,1,1],authenticated:[0,1,1,1],teacher:[0,0,1,1],student:[0,1,0,1],admin:[0,0,0,1],owner:[0,0,1,0]};
 for(const audience of Object.keys(DOCUMENT_AUDIENCES))assert.deepEqual(actors.map(x=>Number(canViewDocument(x,row(audience)))),expected[audience],audience);
});
test('disabled and expired documents unavailable to all',()=>{
 for(const x of [null,student,teacher,admin]){
  assert.equal(canViewDocument(x,{...row('public'),hoat_dong:0}),false);
  assert.equal(canViewDocument(x,{...row('public'),thoi_gian_het_han:'2020-01-01T00:00:00Z'}),false);
  assert.equal(canViewDocument(x,{...row('public'),thoi_gian_het_han:'bad'}),false);
 }
});
test('strict URL, input and expiry validation',()=>{
 const base={tieu_de:'Chương 1',duong_link:'https://example.com/abcd',doi_tuong_duoc_truy_cap:'teacher',thoi_gian_het_han:null,hoat_dong:true};
 assert.equal(normalizeDocumentLinkInput(base).hoat_dong,1);
 for(const url of ['javascript:alert(1)','http://example.com','https://user:password@example.com/','data:text/html,x','https://example.com/\nfoo'])assert.throws(()=>normalizeDocumentLinkInput({...base,duong_link:url}),DocumentLinkInputError);
 for(const audience of ['any','__proto__',null])assert.throws(()=>normalizeDocumentLinkInput({...base,doi_tuong_duoc_truy_cap:audience}),DocumentLinkInputError);
 assert.throws(()=>normalizeDocumentLinkInput({...base,thoi_gian_het_han:'not-a-date'}),DocumentLinkInputError);
});
test('schema required seven business columns and indexes, lazy initialization is tenant-scoped',async()=>{
 const schema=DOCUMENT_LINK_SCHEMA_STATEMENTS[0];
 for(const field of ['id','id_nguoi_tao','tieu_de','duong_link','doi_tuong_duoc_truy_cap','thoi_gian_het_han','hoat_dong']) assert.match(schema,new RegExp('\\b'+field+'\\b'));
 const calls=[];
 const db={connectionUrl:'tenant-doc-1',prepare(sql){calls.push(sql);return {run:async()=>({meta:{changes:1}})};}};
 await Promise.all([ensureDocumentLinkSchema(db),ensureDocumentLinkSchema(db)]);
 assert.equal(calls.length,DOCUMENT_LINK_SCHEMA_STATEMENTS.length);
});
test('Cloudflare API and tab are wired, ownership and time restrictions happen server side',()=>{
 const api=readFileSync('functions/api/documents.ts','utf8');
 const main=readFileSync('src/main.js','utf8');
 const index=readFileSync('index.html','utf8');
 assert.match(api,/verifyAuthSession/);
 assert.match(api,/listDocumentLinks/);
 assert.match(readFileSync('src/document-links-service.js','utf8'),/AND id_nguoi_tao = \?/);
 assert.match(readFileSync('src/document-links-service.js','utf8'),/thoi_gian_het_han > CURRENT_TIMESTAMP/);
 assert.match(readFileSync('src/document-links-service.js','utf8'),/canManageDocument\(actor,existing\)/);
 assert.match(main,/connectDocumentLinks\(\)/);
 assert.match(main,/resetDocumentLinks\(\)/);
 assert.match(index,/data-sidebar-tab="documents"/);
 assert.match(index,/id="tab-documents"/);
});

test('multi-audience access is union of selected roles with legacy compatibility',()=>{
 const rowMulti={...row('teacher'),doi_tuong_truy_cap_nhieu:['teacher','student']};
 assert.deepEqual(documentAudienceValues(rowMulti),['teacher','student']);
 assert.equal(canViewDocument(student,rowMulti),true);
 assert.equal(canViewDocument(teacher,rowMulti),true);
 assert.equal(canViewDocument(null,rowMulti),false);
 assert.deepEqual(documentAudienceValues(row('teacher')),['teacher']);
 const input={tieu_de:'Tin học',duong_link:'https://example.com/file',doi_tuong_duoc_truy_cap:'teacher',doi_tuong_truy_cap_nhieu:['teacher','student'],thoi_gian_het_han:null,hoat_dong:true};
 assert.deepEqual(normalizeDocumentLinkInput(input).doi_tuong_truy_cap_nhieu,['teacher','student']);
 assert.throws(()=>normalizeDocumentLinkInput({...input,doi_tuong_truy_cap_nhieu:[]}),DocumentLinkInputError);
 assert.throws(()=>normalizeDocumentLinkInput({...input,doi_tuong_truy_cap_nhieu:['teacher','evil']}),DocumentLinkInputError);
 assert.throws(()=>normalizeDocumentLinkInput({...input,doi_tuong_truy_cap_nhieu:['student']}),DocumentLinkInputError);
});
test('responsive markup includes mobile cards, two metadata columns and multi-checkbox',()=>{
 const html=readFileSync('public/components/tab-documents.html','utf8');
 const ui=readFileSync('src/document-links-ui.js','utf8');
 assert.match(html,/id="documents-mobile-list"/);
 assert.match(html,/>Mô tả<\/th>/);
 assert.match(html,/>Danh mục<\/th>/);
 assert.match(html,/name="doi_tuong_truy_cap_nhieu"/);
 assert.match(ui,/documents-mobile-list/);
 assert.match(ui,/documents-audience-error/);
});

test('server-granted row permissions drive edit buttons, never claimed profile admin',()=>{
 const profileAdmin={id:'student-profile',role:'user',target_audience:'Quản trị viên'};
 assert.notEqual(documentActorRole(profileAdmin),'admin');
 assert.equal(canManageDocument(profileAdmin),false);
 assert.equal(canEditDocumentRow(true,{co_quyen_quan_ly:true}),true);
 assert.equal(canEditDocumentRow(true,{co_quyen_quan_ly:false}),false);
 assert.equal(canEditDocumentRow(true,{}),false);
 assert.equal(canEditDocumentRow(false,{co_quyen_quan_ly:true}),false);
 const ui=readFileSync('src/document-links-ui.js','utf8');
 assert.match(ui,/canEditDocumentRow\(manage,r\)/);
 assert.match(ui,/if\(id&&!canEditDocumentRow\(manage,found\)\)return/);
});

test('owner-only audience hides private document from non-creators including admins',()=>{
 const privateRow={...row('owner'),doi_tuong_truy_cap_nhieu:['owner']};
 assert.equal(canViewDocument(teacher,privateRow),true);
 for (const other of [null,student,teacher2,admin]) assert.equal(canViewDocument(other,privateRow),false);
 assert.equal(canViewDocument(teacher,{...privateRow,doi_tuong_truy_cap_nhieu:['public','owner']}),true);
 assert.equal(canViewDocument(admin,{...privateRow,doi_tuong_truy_cap_nhieu:['public','owner']}),false);
 const input={tieu_de:'Chính chủ',duong_link:'https://example.com/private',doi_tuong_duoc_truy_cap:'owner',doi_tuong_truy_cap_nhieu:['owner'],hoat_dong:1};
 assert.deepEqual(normalizeDocumentLinkInput(input).doi_tuong_truy_cap_nhieu,['owner']);
 assert.throws(()=>normalizeDocumentLinkInput({...input,doi_tuong_truy_cap_nhieu:['owner','public']}),DocumentLinkInputError);
});
