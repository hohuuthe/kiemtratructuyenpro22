import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildQrCardPayload,
  parseQrCardPayload,
  answerFromQrAngle,
  answerFromQrLocation
} from '../src/qr-card-orientation.js';

test('QR card payload contains only opaque token and version marker', () => {
  const token='0123456789abcdef0123456789abcdef0123';
  const payload=buildQrCardPayload(token);
  assert.equal(payload,'KTTTQR1|'+token+'|ABCD');
  assert.deepEqual(parseQrCardPayload(payload),{version:'KTTTQR1',cardToken:token});
  assert.equal(parseQrCardPayload('KTTTQR1|Nguyen Van A|ABCD'),null);
  assert.equal(parseQrCardPayload('bad|'+token+'|ABCD'),null);
});

test('orientation maps printed A/B/C/D edges to the correct answer', () => {
  assert.equal(answerFromQrAngle(0)?.answer,'A');
  assert.equal(answerFromQrAngle(8)?.answer,'A');
  assert.equal(answerFromQrAngle(-90)?.answer,'B');
  assert.equal(answerFromQrAngle(-82)?.answer,'B');
  assert.equal(answerFromQrAngle(179)?.answer,'C');
  assert.equal(answerFromQrAngle(-179)?.answer,'C');
  assert.equal(answerFromQrAngle(90)?.answer,'D');
  assert.equal(answerFromQrAngle(98)?.answer,'D');
});

test('orientation can be derived directly from QR top edge corners', () => {
  assert.equal(answerFromQrLocation({topLeftCorner:{x:10,y:20},topRightCorner:{x:110,y:20}})?.answer,'A');
  assert.equal(answerFromQrLocation({topLeftCorner:{x:100,y:120},topRightCorner:{x:100,y:20}})?.answer,'B');
  assert.equal(answerFromQrLocation({topLeftCorner:{x:110,y:20},topRightCorner:{x:10,y:20}})?.answer,'C');
  assert.equal(answerFromQrLocation({topLeftCorner:{x:20,y:10},topRightCorner:{x:20,y:110}})?.answer,'D');
});

test('server API enforces teacher scope, stable ABCD answers and no fake zero result', () => {
  const api=fs.readFileSync('functions/api/qr-cards.ts','utf8');
  assert.match(api,/Chức năng quét thẻ chỉ dành cho Giáo viên\/Admin/);
  assert.match(api,/Bạn chỉ được quét thẻ cho lớp đã được phân công/);
  assert.match(api,/Giáo viên chỉ được dùng chức năng quét thẻ với đề thi do mình tạo/);
  assert.match(api,/\['A','B','C','D'\]\.includes\(answer\)/);
  assert.match(api,/Math\.max\(3,/);
  assert.match(api,/Chưa có học sinh nào được quét ổn định; không tạo kết quả/);
  assert.match(api,/reason: 'Chưa có đáp án quét'/);
  assert.match(api,/loai_thi_sinh/);
  assert.match(api,/'Quét thẻ QR'/);
  assert.match(api,/status='finalizing'/);
  assert.match(api,/qr_answer_result_links/);
  assert.match(api,/ON CONFLICT\(session_id,user_id\) DO NOTHING/);
  assert.match(api,/finalizeLockSessionId/);
  assert.match(api,/creator_id IN \(SELECT user_id FROM accounts WHERE id = \?\)/);
  assert.match(api,/lessonAllowed/);
});

test('printed cards expose identity and A/B/C/D while QR payload stays tokenized', () => {
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  assert.match(ui,/Mã HS:/);
  assert.match(ui,/class="answer top">A/);
  assert.match(ui,/class="answer right">B/);
  assert.match(ui,/class="answer bottom">C/);
  assert.match(ui,/class="answer left">D/);
  assert.match(ui,/buildQrCardPayload\(s\.card_token\)/);
  assert.doesNotMatch(ui,/buildQrCardPayload\(s\.full_name/);
  assert.match(ui,/getUserMedia/);
  assert.match(ui,/decodeMultiple/);
  assert.match(ui,/hits >= 3/);
  assert.match(ui,/action: 'record-batch'/);
  assert.match(ui,/action: 'finalize'/);
  assert.match(ui,/async function flushAllPending/);
  assert.match(ui,/Promise\.all\(roster\.map/);
});

test('app integrates QR scanner as lazy teacher/admin tab and resets camera on navigation', () => {
  const html=fs.readFileSync('index.html','utf8');
  const main=fs.readFileSync('src/main.js','utf8');
  assert.match(html,/data-sidebar-tab="qr-cards"/);
  assert.match(html,/id="tab-qr-cards"/);
  assert.match(main,/protectedTabs=\[[^\]]*'qr-cards'/);
  assert.match(main,/tab === 'questions' \|\| tab === 'exams' \|\| tab === 'exam-editor' \|\| tab === 'qr-cards'/);
  assert.match(main,/import\('\.\/qr-answer-cards-ui\.js'\)/);
  assert.match(main,/__resetQrAnswerCards/);
});
