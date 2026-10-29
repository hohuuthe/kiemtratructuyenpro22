import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {QUESTION_CREATOR_JOIN_SQL,QUESTION_CREATOR_NAME_SQL,questionAuthorDisplayName} from '../src/question-creator-identity.js';
import {questionTeacherOptions} from '../src/question-teacher-filter.js';
test('question authors use server-verified names even when no accounts are loaded',()=>{
  assert.equal(questionAuthorDisplayName({creatorId:'a1',creatorName:'Giáo viên A'},{}),'Giáo viên A');
  assert.equal(questionAuthorDisplayName({creator_id:'a2',creator_name:'Giáo viên B'},{}),'Giáo viên B');
  assert.equal(questionAuthorDisplayName({creator_id:'a3'},{a3:'Tên tài khoản'}),'Tên tài khoản');
  assert.equal(questionAuthorDisplayName({creator_id:'missing'},{}),'Chưa liên kết hồ sơ tác giả');
  assert.equal(questionAuthorDisplayName({},{}),'Chưa có mã tác giả');
});
test('teacher filtering displays server names without downloading accounts',()=>{
  const questions=[{creatorId:'a1',creatorName:'Giáo viên A'},{creatorId:'a2',creatorName:'Giáo viên B'}];
  const choices=questionTeacherOptions(questions,[],null,true);
  assert.equal(choices.length,2);
  assert.deepEqual(choices.map(x=>x.label),['Giáo viên A','Giáo viên B']);
  assert.equal(questionTeacherOptions(questions,[],null,false).length,0);
});
test('question author joins accounts and profiles by verified IDs',()=>{
  assert.match(QUESTION_CREATOR_JOIN_SQL,/author_account.id = q.creator_id/);
  assert.match(QUESTION_CREATOR_JOIN_SQL,/author_account.user_id/);
  assert.match(QUESTION_CREATOR_NAME_SQL,/author_profile.full_name/);
});
test('both API implementations expose only scoped author names',()=>{
  const cf=readFileSync('functions/api/questions.ts','utf8');
  const express=readFileSync('server.ts','utf8');
  const client=readFileSync('src/main.js','utf8');
  assert.match(cf,/QUESTION_CREATOR_JOIN_SQL/);
  assert.match(cf,/creatorName: q.creator_name/);
  assert.match(express,/QUESTION_CREATOR_JOIN_SQL/);
  assert.match(express,/creatorName: q.creator_name/);
  assert.match(client,/creatorName: q.creatorName \|\| q.creator_name/);
  assert.match(client,/questionAuthorDisplayName\(q,accountsMap,currentUser\)/);
});
