import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildExamAttemptLimitModal,buildExamReadyModal} from '../src/student-exam-start-guard.js';

test('both student exam dialogs use the exact same isolated compact size',()=>{
 const main=readFileSync('src/main.js','utf8'),css=readFileSync('src/style.css','utf8');
 assert.match(main,/showModal\(buildExamAttemptLimitModal\(examName, limitInfo\), 'student-exam-compact'/);
 assert.match(main,/showModal\(buildExamReadyModal\(\), 'student-exam-compact'/);
 assert.match(main,/el\.classList\.add\('student-exam-compact-modal'\)/);
 assert.match(css,/#modal-content\.student-exam-compact-modal\s*\{/);
 assert.match(css,/width:\s*min\(400px, calc\(100vw - 32px\)\) !important/);
 assert.match(css,/height:\s*auto !important/);
 assert.match(css,/max-height:\s*calc\(100dvh - 32px\) !important/);
 assert.match(css,/animation:\s*none !important/);
});
test('stable content, buttons and safe exam title rendering',()=>{
 const limit=buildExamAttemptLimitModal('<img src=x>',{attemptCount:2,maxAttempts:2});
 const ready=buildExamReadyModal();
 assert.match(limit,/id="exam-attempt-limit-confirm"/);
 assert.match(ready,/id="exam-start-ready-confirm"/);
 assert.match(ready,/id="exam-start-ready-cancel"/);
 assert.match(limit,/&lt;img src=x&gt;/);
 assert.doesNotMatch(limit,/<img/);
 for(const markup of [limit,ready]) assert.match(markup,/student-exam-compact-body/);
});
test('old closed modal cannot clear new open dialog or preserve former sizing',()=>{
 const main=readFileSync('src/main.js','utf8');
 assert.match(main,/if \(modalContentClearTimer !== null\)\s*\{\s*clearTimeout\(modalContentClearTimer\)/);
 assert.match(main,/if \(isVisible\) return/);
 assert.match(main,/for \(const property of \['width', 'maxWidth', 'minWidth', 'height', 'maxHeight', 'minHeight'/);
 assert.match(main,/el\.classList\.remove\('always-scrollbar-y', 'question-authoring-modal', 'exam-export-modal',\s*'student-results-detail-modal', 'student-exam-compact-modal'\)/);
});
