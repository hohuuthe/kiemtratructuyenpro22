import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXAM_CREATOR_JOIN_SQL,EXAM_CREATOR_NAME_SQL,examCreatorDisplayName} from '../src/exam-creator-identity.js';
import {parseManagementPage,resultsPageQuery} from '../src/management-page-queries.js';
test('creator name respects canonical server ID and does not guess from exam name',()=>{
 assert.equal(examCreatorDisplayName({examCreatorId:'account1',examCreatorName:'Giáo viên A'}),'Giáo viên A');
 assert.equal(examCreatorDisplayName({creator_id:'account2',creator_name:'Giáo viên B'}),'Giáo viên B');
 assert.equal(examCreatorDisplayName({creator_id:'account3'},{account3:'Giáo viên C'}),'Giáo viên C');
 assert.equal(examCreatorDisplayName({creator_id:'other'}, {}, {id:'me',full_name:'Giáo viên D'}),'Chưa rõ tên người tạo (ID: other)');
 assert.match(examCreatorDisplayName({}),/thiếu mã đề/);
});
test('account-profile join resolves account id and legacy profile id',()=>{
 assert.match(EXAM_CREATOR_JOIN_SQL,/creator_account.id = ec.creator_id/);
 assert.match(EXAM_CREATOR_JOIN_SQL,/creator_account.user_id/);
 assert.match(EXAM_CREATOR_NAME_SQL,/creator_profile.full_name/);
 assert.match(EXAM_CREATOR_NAME_SQL,/creator_account.username/);
});
test('paginated results return creator id and name without full accounts prefetch',()=>{
 const q=resultsPageQuery(parseManagementPage('https://example.com/api/results-page'),{id:'admin',role:'admin'});
 assert.match(q.rowsSQL,/AS exam_creator_id/);
 assert.match(q.rowsSQL,/AS exam_creator_name/);
 assert.doesNotMatch(q.countSQL,/creator_profile/);
 assert.doesNotMatch(q.rowsSQL,/r.details/);
});
test('both API runtimes project creator name and UI uses it for both views',()=>{
 const cf=readFileSync('functions/api/exams.ts','utf8');
 const express=readFileSync('server.ts','utf8');
 const ui=readFileSync('src/main.js','utf8');
 assert.match(cf,/EXAM_CREATOR_NAME_SQL/);
 assert.match(cf,/creatorName: row.creator_name/);
 assert.match(express,/EXAM_CREATOR_NAME_SQL/);
 assert.match(express,/creatorName: row.creator_name/);
 assert.match(ui,/examCreatorName:r.exam_creator_name/);
 assert.match(ui,/examCreatorDisplayName\(item,accountsMap,currentUser\)/);
 assert.match(ui,/examCreatorDisplayName\(r,accountsMap,currentUser\)/);
});
