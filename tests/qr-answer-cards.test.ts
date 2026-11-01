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
  assert.match(api,/already_finalized: true/);
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


test('presenter and scanner share authoritative server question state',()=>{
  const api=fs.readFileSync('functions/api/qr-cards.ts','utf8');
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const html=fs.readFileSync('public/components/tab-qr-cards.html','utf8');
  const schema=fs.readFileSync('database-schema.sql','utf8');

  assert.match(schema,/join_code TEXT NOT NULL DEFAULT ''/);
  assert.match(schema,/current_question_index INTEGER NOT NULL DEFAULT 0/);
  assert.match(schema,/current_question_id TEXT NOT NULL DEFAULT ''/);
  assert.match(schema,/collection_state TEXT NOT NULL DEFAULT 'collecting'/);
  assert.match(schema,/state_revision INTEGER NOT NULL DEFAULT 1/);
  assert.match(schema,/response_revision INTEGER NOT NULL DEFAULT 0/);

  assert.match(api,/action === 'session-state'/);
  assert.match(api,/action === 'active-sessions'/);
  assert.match(api,/action === 'set-current-question'/);
  assert.match(api,/action === 'set-collection-state'/);
  assert.match(api,/LOCK_BEFORE_NAVIGATE/);
  assert.match(api,/LOCK_BEFORE_FINALIZE/);
  assert.match(api,/questionId !== currentQuestionId/);
  assert.match(api,/QUESTION_LOCKED/);
  assert.match(api,/response_revision=response_revision\+1/);

  assert.match(html,/id="qr-card-presenter-workspace"/);
  assert.match(html,/id="qr-card-open-scanner"/);
  assert.match(html,/id="qr-presenter-lock"/);
  assert.match(html,/id="qr-scanner-collection-state"/);

  assert.match(ui,/async function syncSessionState/);
  assert.match(ui,/async function enterPresenter/);
  assert.match(ui,/async function enterScanner/);
  assert.match(ui,/async function presenterNavigate/);
  assert.match(ui,/deviceRole!=='scanner'/);
  assert.match(ui,/collectionState!=='collecting'/);
  assert.match(ui,/setTimeout\(flushPending, 80\)/);
});

test('presenter locks before navigation and finalization to avoid stale phone frames',()=>{
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  assert.match(ui,/if\(collectionState!=='locked'\)await setCollectionState\('locked'\)/);
  assert.match(ui,/if\(deviceRole==='presenter'&&collectionState!=='locked'\)await setCollectionState\('locked'\)/);
  assert.match(ui,/expectedRevision:stateRevision/);
  assert.match(ui,/stateRevision=Number\(result\.data\?\.state_revision/);
});


test('final hardening serializes scan writes with lock and avoids hot-path schema churn',()=>{
  const api=fs.readFileSync('functions/api/qr-cards.ts','utf8');
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');

  assert.match(api,/const qrSchemaReady = new Set<string>\(\)/);
  assert.match(api,/if \(qrSchemaReady\.has\(schemaKey\)\) return/);
  assert.match(api,/qrSchemaReady\.add\(schemaKey\)/);

  // Row-level SHARE lock linearizes answer write vs presenter lock/update.
  assert.match(api,/FROM qr_answer_sessions[\s\S]*collection_state='collecting'[\s\S]*current_question_id=\?[\s\S]*FOR SHARE/);
  assert.match(api,/INSERT INTO qr_answer_responses[\s\S]*FROM active_session/);
  assert.match(api,/DELETE FROM qr_answer_responses r[\s\S]*USING active_session/);

  // Finalize only wins if the same locked revision is still current.
  assert.match(api,/status='finalizing',state_revision=state_revision\+1/);
  assert.match(api,/status='open' AND collection_state='locked' AND state_revision=\?/);
  assert.match(api,/FINALIZE_REVISION_CONFLICT/);

  // Polling no longer reloads the entire class roster; UI derives totals from its session snapshot.
  assert.doesNotMatch(api,/const students = await classStudents\(db, session\.class_name, session\.donvi \|\| ''\);[\s\S]{0,900}answered_count: responses\.length/);
  assert.match(ui,/const studentCount=Number\(session\.students\?\.length\|\|0\)/);
  assert.match(ui,/acceptedKeys/);
  assert.match(ui,/pendingVisualAnswers/);
  assert.match(ui,/answersForQuestion\(row\.question_id\)\.set/);
  assert.doesNotMatch(ui,/map\.set\(uid, answer\);\s*pendingRecords\.set/);
});


test('phone scanner only confirms answers after server persistence and distinguishes locked state',()=>{
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const html=fs.readFileSync('public/components/tab-qr-cards.html','utf8');
  const css=fs.readFileSync('src/style.css','utf8');
  const api=fs.readFileSync('functions/api/qr-cards.ts','utf8');

  assert.match(html,/id="qr-card-save-status"/);
  assert.match(ui,/pendingVisualAnswers/);
  assert.match(ui,/Đã lưu & đồng bộ/);
  assert.match(ui,/CÂU ĐÃ KHÓA · camera chỉ xem, không lưu/);
  assert.match(ui,/ĐÃ KHÓA, KHÔNG LƯU/);
  assert.match(ui,/result\.data\?\.accepted/);
  assert.match(ui,/answersForQuestion\(row\.question_id\)\.set/);
  assert.match(api,/rejected/);
  assert.match(api,/CARD_NOT_IN_CLASS/);
  assert.match(api,/STATE_CHANGED/);
  assert.match(api,/collection_state:/);
  assert.match(css,/#qr-card-scan-workspace[\s\S]*overflow-x:hidden/);
  assert.match(css,/\.qr-scanner-statuses[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.qr-camera-actions[\s\S]*grid-template-columns:1fr 1fr/);
});


test('mobile QR interface is scanner-only and avoids loading desktop setup data',()=>{
  const html=fs.readFileSync('public/components/tab-qr-cards.html','utf8');
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const css=fs.readFileSync('src/style.css','utf8');

  assert.match(html,/id="qr-card-setup" class="qr-desktop-only/);
  assert.match(html,/id="qr-card-class-summary" class="qr-desktop-only/);
  assert.match(html,/id="qr-card-presenter-workspace" class="qr-desktop-only/);
  assert.match(html,/id="qr-card-open-presenter"[^>]*qr-desktop-only/);
  assert.match(html,/id="qr-card-stop-camera-mobile"/);
  assert.match(html,/qr-mobile-question-detail/);
  assert.match(html,/qr-answer-stats/);
  assert.match(html,/qr-student-panel/);

  assert.match(ui,/function isMobileScannerViewport/);
  assert.match(ui,/if\(mobileScannerMode\)\{[\s\S]*await loadActiveSessions\(\);[\s\S]*return;/);
  assert.match(ui,/qr-mobile-scanner-mode/);
  assert.match(ui,/qr-card-stop-camera-mobile/);

  assert.match(css,/qr-mobile-scanner-mode \.qr-desktop-only \{ display:none!important; \}/);
  assert.match(css,/qr-mobile-scanner-mode \.qr-mobile-question-detail[\s\S]*display:none!important/);
  assert.match(css,/qr-mobile-scanner-mode \.qr-answer-stats[\s\S]*display:none!important/);
  assert.match(css,/qr-mobile-scanner-mode \.qr-student-panel[\s\S]*display:none!important/);
  assert.match(css,/qr-mobile-scanner-mode \.qr-camera-wrap[\s\S]*height:calc\(100dvh - 255px\)/);
});


test('phone persistence uses durable ACK queue and presenter shows only server-saved answers',()=>{
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const html=fs.readFileSync('public/components/tab-qr-cards.html','utf8');
  const css=fs.readFileSync('src/style.css','utf8');
  const api=fs.readFileSync('functions/api/qr-cards.ts','utf8');

  // Phone queue: keep records until server ACK, serialize requests, persist across reload.
  assert.match(ui,/if\(saveInFlight\)[\s\S]*setTimeout\(queueFlush,120\)/);
  assert.match(ui,/function persistPendingQueue/);
  assert.match(ui,/function restorePendingQueue/);
  assert.match(ui,/localStorage\.setItem\(pendingQueueStorageKey\(session\.id\)/);
  assert.match(ui,/pendingRecords\.delete\(key\);[\s\S]*acceptedKeys\.add|acceptedKeys\.add\(key\);[\s\S]*pendingRecords\.delete\(key\)/);
  assert.match(ui,/reason==='STATE_CHANGED'/);
  assert.match(ui,/Mất kết nối · giữ .* đáp án và tự gửi lại/);
  assert.doesNotMatch(ui,/for\(const item of batchEntries\)if\(item\.key\)pendingRecords\.delete/);

  // Server gives explicit per-student ACK with identity and persisted timestamp.
  assert.match(api,/card_token: cardToken/);
  assert.match(api,/saved_at: now/);
  assert.match(api,/SELECT r\.user_id,r\.card_token,r\.answer,r\.stable_hits,r\.updated_at/);

  // Presenter monitor is adjacent to the question and renders only state.responses (persisted rows).
  assert.match(html,/qr-presenter-live-grid/);
  assert.match(html,/id="qr-presenter-response-list"/);
  assert.match(html,/Máy quét đã ghi nhận/);
  assert.match(ui,/function renderPresenterMonitor/);
  assert.match(ui,/const responses=Array\.isArray\(state\?\.responses\)\?state\.responses:\[\]/);
  assert.match(ui,/qr-presenter-answer-pill/);
  assert.match(css,/\.qr-presenter-live-grid[\s\S]*grid-template-columns/);
  assert.match(css,/\.qr-presenter-response-list[\s\S]*overflow-y:auto/);
});
