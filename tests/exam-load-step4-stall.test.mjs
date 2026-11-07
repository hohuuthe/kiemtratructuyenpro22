import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync('src/main.js','utf8');
function section(start,end){
 const a=app.indexOf(start); assert.ok(a>=0,'missing '+start);
 const b=app.indexOf(end,a+start.length); assert.ok(b>a,'missing '+end);
 return app.slice(a,b);
}

test('verified exam load uses no-network fast path after step 4',()=>{
 const load=section('window.loadExamConfigById = async function loadExamConfigById','window.openExportDocxModal');
 assert.ok(load.includes("progress.update(92, 'Bước 4/5'"));
 assert.ok(!load.includes('await openExamEditorTab({newExam:false})'));
 const switchAt=load.indexOf("switchTab('exam-editor')");
 const fastAt=load.indexOf('initializeExamEditorFromVerifiedPool()');
 const applyAt=load.indexOf('applyExamConfig(resJson.data)');
 assert.ok(switchAt>=0 && fastAt>switchAt && applyAt>fastAt);
});

test('fast path contains no network await and invalidates old async init',()=>{
 const fast=section('function initializeExamEditorFromVerifiedPool()','window.initializeExamEditorFromVerifiedPool');
 assert.match(fast,/examEditorInitSeq \+= 1/);
 assert.match(fast,/examEditorInitializing = null/);
 assert.ok(!fast.includes('fetch('));
 assert.ok(!fast.includes('await '));
 assert.ok(!fast.includes('updateExamNamesList'));
 assert.ok(!fast.includes('preloadRoleScopedIdentityOnLogin'));
});

test('normal editor init is sequence guarded against stale completion',()=>{
 const init=section('async function initExamPanel()','function updateExamGlobalStats()');
 assert.match(init,/const initSeq = \+\+examEditorInitSeq/);
 assert.match(init,/initSeq === examEditorInitSeq/);
 assert.match(init,/if \(!isCurrentInit\(\)\) return/);
});
