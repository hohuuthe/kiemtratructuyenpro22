import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const security = readFileSync('functions/api/exam/security.ts','utf8');
const pages = readFileSync('functions/api/exams.ts','utf8');
const express = readFileSync('server.ts','utf8');
const main = readFileSync('src/main.js','utf8');
test('the API requires a code before revealing a protected exam',()=>{
 assert.match(pages,/examAccessChallenge\(user,row,accessCode\)/);
 assert.match(pages,/X-Exam-Access-Code/);
 assert.match(pages,/isProtectedExamForUser\(user,row\)/);
 assert.match(express,/examAccessChallenge\(user,row,req\.header\('X-Exam-Access-Code'\)\)/);
 assert.match(express,/protectedExamPreview\(row\)/);
 assert.match(security,/EXAM_ACCESS_CODE_REQUIRED/);
 assert.match(security,/EXAM_ACCESS_CODE_INVALID/);
});
test('exam generator checks the password, not a client-issued state flag',()=>{
 assert.match(readFileSync('functions/api/exam/generate.ts','utf8'),/accessCodeMatches\(submittedAccessCode, dbExam\.mabaomatdethi\)/);
 assert.match(express,/accessCodeMatches\(examAccessCode,dbExam\.mabaomatdethi\)/);
});
test('student password form stays open until the server verifies the supplied code',()=>{
 assert.match(main,/id="confirm-password-btn" disabled/);
 assert.match(main,/confirm\.disabled=busy\|\|!input\.value\.trim\(\)/);
 assert.match(main,/if\(!response\.ok\|\|!result\.data\)/);
 assert.match(main,/error\.textContent=result\.error/);
 assert.match(main,/window\._studentExamVerifiedId = selectedExamId/);
 assert.match(main,/window\._studentExamVerifiedId !== selectedExamId/);
 assert.match(main,/examConfig\?\.id === studentExam/);
});
