import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildQrCardPayload,
  parseQrCardPayload,
  answerFromQrAngle,
  answerFromQrLocation
} from '../src/qr-card-orientation.js';

test('QR card payload uses compact V2 and still parses legacy V1 cards', () => {
  const token='0123456789abcdef0123456789abcdef0123';
  const payload=buildQrCardPayload(token);
  assert.match(payload,/^K2\.[A-Za-z0-9_-]+$/);
  assert.ok(payload.length < ('KTTTQR1|'+token+'|ABCD').length);
  assert.deepEqual(parseQrCardPayload(payload),{version:'K2',cardToken:token});
  assert.deepEqual(parseQrCardPayload('KTTTQR1|'+token+'|ABCD'),{version:'KTTTQR1',cardToken:token});
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
  assert.match(api,/\['A','B','C','D'\]\.includes\(row\.answer\)/);
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
  assert.match(ui,/hits>=2/);
  assert.match(ui,/action\s*:\s*['"]record-batch['"]/);
  assert.match(ui,/action\s*:\s*['"]finalize['"]/);
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
  assert.match(api,/INSERT INTO qr_answer_responses[\s\S]*JOIN active_session/);
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
  assert.match(api,/card_token: row\.card_token/);
  assert.match(api,/saved_at: row\.updated_at \|\| now/);
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


test('long-range scanner uses hybrid native multi-QR and high-resolution tiled fallback',()=>{
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const worker=fs.readFileSync('src/qr-scan-worker.js','utf8');
  const orientation=fs.readFileSync('src/qr-card-orientation.js','utf8');

  assert.match(ui,/BarcodeDetector/);
  assert.match(ui,/new window\.BarcodeDetector\(\{formats:\['qr_code'\]\}\)/);
  assert.match(ui,/decodeJsQrTiles/);
  assert.match(ui,/new Worker\(new URL\('\.\/qr-scan-worker\.js',import\.meta\.url\)/);
  assert.match(ui,/scanMode==='far'/);
  assert.match(ui,/const plan=scanDecodePlan\(video\.videoWidth\)/);
  assert.match(ui,/const targetW=plan\.targetW/);
  assert.match(worker,/cols=far\?\(width>=1500\?4:3\)/);
  assert.match(worker,/overlap=far\?\.28:\.20/);
  assert.match(worker,/upscaleByTier/);
  assert.match(worker,/high:\(width>=1500\?2\.35:2\.05\)/);
  assert.match(ui,/targetW=Math\.min\(maxW,mode==='far'\?2560:1920\)/);
  assert.match(ui,/width:\{ideal:1920\}/);
  assert.match(ui,/height:\{ideal:1080\}/);
  assert.match(ui,/focusMode:'continuous'/);
  assert.match(ui,/applyCameraZoom/);
  assert.match(ui,/toggleTorch/);
  assert.match(ui,/errorCorrectionLevel: 'M'/);
  assert.match(ui,/margin: 4/);
  assert.match(ui,/width: 640/);
  assert.match(ui,/width:82mm;height:82mm/);
  assert.match(ui,/objectFit==='cover'/);

  assert.match(orientation,/QR_CARD_PREFIX_V2 = 'K2'/);
  assert.match(orientation,/buildQrCardPayload/);
  assert.match(orientation,/parseQrCardPayload/);
  assert.match(orientation,/Legacy V1 cards remain fully supported/);
});


test('QR scanner is VIP-only for teachers and admin bypasses VIP',()=>{
  const api=fs.readFileSync('functions/api/qr-cards.ts','utf8');
  const html=fs.readFileSync('index.html','utf8');
  const main=fs.readFileSync('src/main.js','utf8');

  assert.match(api,/VIP_REQUIRED/);
  assert.match(api,/0935 078 895/);
  assert.match(api,/!admin && !Boolean\(user\?\.is_vip\)/);

  assert.match(html,/data-sidebar-tab="qr-cards"[\s\S]*VIP/);
  assert.match(main,/function canUseQrScannerVip/);
  assert.match(main,/function showQrScannerVipRequiredModal/);
  assert.match(main,/0935 078 895/);
  assert.match(main,/tabName === 'qr-cards'[\s\S]*!canUseQrScannerVip\(\)/);
});

test('QR hot paths use bounded bulk SQL instead of per-student database loops',()=>{
  const api=fs.readFileSync('functions/api/qr-cards.ts','utf8');

  // Schema hot path is one probe then a one-shot exec migration only on missing schema.
  assert.match(api,/Hot path: exactly one lightweight query/);
  assert.match(api,/if \(typeof db\.exec === 'function'\)/);

  const recordStart=api.indexOf("if (action === 'record-batch')");
  const clearStart=api.indexOf("if (action === 'clear-answer')",recordStart);
  const recordBlock=api.slice(recordStart,clearStart);
  assert.match(recordBlock,/card_token IN \(\$\{cardPlaceholders\}\)/);
  assert.match(recordBlock,/incoming\(session_id,question_id,user_id,card_token,answer,stable_hits,updated_at\)/);
  assert.match(recordBlock,/RETURNING user_id,question_id,card_token,answer,stable_hits,updated_at/);
  assert.doesNotMatch(recordBlock,/for \(const raw of records\)[\s\S]*await db\.prepare/);

  const ensureStart=api.indexOf("if (action === 'ensure-cards')");
  const startSession=api.indexOf("if (action === 'start-session')",ensureStart);
  const ensureBlock=api.slice(ensureStart,startSession);
  assert.match(ensureBlock,/VALUES \$\{valuesSql\}/);
  assert.doesNotMatch(ensureBlock,/for \(const student of students\)[\s\S]*await db\.prepare/);

  const finalizeStart=api.indexOf("if (action === 'finalize')");
  const finalizeEnd=api.indexOf("return reply\(\{ error: 'Thao tác không hợp lệ\.'",finalizeStart);
  const finalizeBlock=api.slice(finalizeStart,finalizeEnd>finalizeStart?finalizeEnd:undefined);
  assert.match(finalizeBlock,/resultValuesSql/);
  assert.match(finalizeBlock,/ON CONFLICT\(id\) DO NOTHING/);
  assert.match(finalizeBlock,/qr_answer_result_links\(session_id,user_id,result_id,created_at\)/);
  assert.match(finalizeBlock,/for \(const student of students\)[\s\S]*resultDrafts\.push/);
  assert.match(finalizeBlock,/const resultValuesSql = persistedDrafts\.map/);
});


test('QR presenter mirrors student exam styling and shows full class roster with green recorded rows',()=>{
  const html=fs.readFileSync('public/components/tab-qr-cards.html','utf8');
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const css=fs.readFileSync('src/style.css','utf8');

  assert.match(html,/qr-presenter-question-accent/);
  assert.match(html,/Hiển thị toàn bộ học sinh; hàng xanh là đã lưu trên server/);
  assert.match(html,/id="qr-presenter-response-count"[^>]*>0\/0 đã ghi nhận/);

  assert.match(ui,/const students=Array\.isArray\(session\?\.students\)\?session\.students:\[\]/);
  assert.match(ui,/const responseByUser=new Map\(responses\.map/);
  assert.match(ui,/is-recorded/);
  assert.match(ui,/is-waiting/);
  assert.match(ui,/responses\.length\+'\/'\+rows\.length\+' đã ghi nhận'/);

  assert.match(css,/\.qr-presenter-question-accent/);
  assert.match(css,/\.qr-presenter-response-row\.is-recorded[\s\S]*background:#dcfce7/);
  assert.match(css,/\.qr-presenter-option:nth-child\(2\)/);
});


test('QR presenter fullscreen uses full desktop width and monitor keeps full student names',()=>{
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const css=fs.readFileSync('src/style.css','utf8');

  assert.match(ui,/qr-presenter-student-name/);
  assert.doesNotMatch(ui,/qr-presenter-student-name[^\n]*truncate/);
  assert.match(css,/\.qr-presenter-live-grid \{[\s\S]*grid-template-columns:minmax\(0,1fr\) minmax\(245px,275px\)/);
  assert.match(css,/\.qr-presenter-student-name \{[\s\S]*white-space:nowrap/);
  assert.match(css,/#qr-card-presenter-workspace:fullscreen \.qr-presenter-main \{[\s\S]*padding:8px 10px 10px/);
  assert.match(css,/#qr-card-presenter-workspace:fullscreen \.qr-presenter-live-grid \{[\s\S]*grid-template-columns:minmax\(0,1fr\) minmax\(230px,255px\)/);
  assert.doesNotMatch(css,/#qr-card-presenter-workspace:fullscreen \.qr-presenter-main \{[\s\S]{0,250}padding:32px 5vw/);
});


test('QR presenter removes waiting badges, keeps one-line names, uses student MC layout and shared math pipeline',()=>{
  const html=fs.readFileSync('public/components/tab-qr-cards.html','utf8');
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const css=fs.readFileSync('src/style.css','utf8');

  assert.match(html,/id="qr-presenter-settings"/);
  assert.match(html,/id="qr-presenter-question-size"/);
  assert.match(html,/id="qr-presenter-answer-size"/);

  assert.doesNotMatch(ui,/qr-presenter-waiting-pill">Chưa nhận/);
  assert.doesNotMatch(ui,/qr-presenter-status-waiting[^\n]*Chờ quét/);
  assert.match(ui,/qr-presenter-option-label/);
  assert.match(ui,/presenterOptionGridClass/);
  assert.match(ui,/grid-cols-1 sm:grid-cols-2 lg:grid-cols-4/);
  assert.match(ui,/window\.renderScientificContent/);
  assert.match(ui,/window\.queueMathJax/);
  assert.match(ui,/queueScientificMath\(\$\('qr-card-presenter-workspace'\)\)/);

  assert.match(css,/\.qr-presenter-student-name \{[\s\S]*white-space:nowrap/);
  assert.match(css,/\.qr-presenter-option-content \{[\s\S]*font-size:var\(--qr-presenter-a-size\)/);
  assert.match(css,/\.qr-presenter-option-label \{[\s\S]*display:inline/);
});


test('professional classroom scanner runs heavy decoding off the UI thread',()=>{
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const worker=fs.readFileSync('src/qr-scan-worker.js','utf8');
  const html=fs.readFileSync('public/components/tab-qr-cards.html','utf8');
  const css=fs.readFileSync('src/style.css','utf8');
  const api=fs.readFileSync('functions/api/qr-cards.ts','utf8');

  assert.match(ui,/new Worker\(new URL\('\.\/qr-scan-worker\.js',import\.meta\.url\)/);
  assert.match(ui,/scanWorkerBusy/);
  assert.match(ui,/rememberDetections/);
  assert.match(ui,/detectionMemory/);
  assert.match(ui,/if\(mapped\.length\)processDetections\(mapped,Number\(msg\.cycle\)\|\|0\)/);
  assert.match(ui,/if\(native\.length\)processDetections\(native,scanCycle\)/);
  assert.doesNotMatch(ui,/processDetections\(rememberDetections/);
  assert.match(ui,/prev&&Number\(prev\.observationCycle\|\|0\)>=Number\(observationCycle\|\|0\)/);
  assert.match(ui,/Number\(msg\.cameraEpoch\)!==cameraEpoch/);
  assert.match(ui,/String\(msg\.questionId\|\|''\)!==String\(currentQuestion\(\)\?\.id\|\|''\)/);
  assert.match(ui,/Number\(msg\.stateRevision\)!==Number\(stateRevision\)/);
  assert.match(ui,/scanMode==='far'/);
  assert.match(ui,/applyCameraZoom/);
  assert.match(ui,/toggleTorch/);
  assert.match(ui,/cameraCapabilities/);
  assert.match(ui,/area>=9000&&confidence>=\.82/);
  assert.match(ui,/hits>=2\|\|score>=1\.55/);

  assert.match(worker,/cols=far\?\(width>=1500\?4:3\)/);
  assert.match(worker,/overlap=far\?\.28:\.20/);
  assert.match(worker,/upscaleByTier/);
  assert.match(worker,/inversion=cycle%5===0\?'attemptBoth':'dontInvert'/);
  assert.match(worker,/maxCodes/);
  assert.match(worker,/cameraEpoch:msg\.cameraEpoch/);
  assert.match(worker,/sessionId:msg\.sessionId/);
  assert.match(worker,/questionId:msg\.questionId/);
  assert.match(worker,/stateRevision:msg\.stateRevision/);

  assert.match(html,/id="qr-card-mode-auto"/);
  assert.match(html,/id="qr-card-mode-far"/);
  assert.match(html,/id="qr-card-torch"/);
  assert.match(html,/id="qr-card-zoom"/);
  assert.match(css,/\.qr-camera-smart-tools/);
  assert.match(css,/\.qr-camera-mode-buttons/);
  assert.match(api,/body\.records\) \? body\.records\.slice\(0, 80\)/);
});


test('QR release checks and workflow include the decoder worker',()=>{
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  const workflow=fs.readFileSync('.github/workflows/qr-answer-cards.yml','utf8');
  assert.match(pkg.scripts['release:qr-cards:check'],/node --check src\/qr-scan-worker\.js/);
  assert.match(workflow,/src\/qr-scan-worker\.js/);
});

test('stale worker frames cannot cross camera sessions or question revisions',()=>{
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  assert.match(ui,/cameraEpoch\+\+/);
  assert.match(ui,/cameraEpoch,/);
  assert.match(ui,/sessionId:String\(session\.id\|\|''\)/);
  assert.match(ui,/questionId:String\(currentQuestion\(\)\?\.id\|\|''\)/);
  assert.match(ui,/stateRevision:Number\(stateRevision\)\|\|0/);
  assert.match(ui,/Number\(msg\.cameraEpoch\)!==cameraEpoch/);
  assert.match(ui,/String\(msg\.sessionId\|\|''\)!==String\(session\?\.id\|\|''\)/);
  assert.match(ui,/collectionState!=='collecting'\)return/);
});


test('commercial-grade QR scanner has watchdog adaptive load camera recovery and invalid-answer protection',()=>{
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  const worker=fs.readFileSync('src/qr-scan-worker.js','utf8');

  assert.match(ui,/scanWorkerStartedAt/);
  assert.match(ui,/function checkScanWorkerWatchdog/);
  assert.match(ui,/performance\.now\(\)-scanWorkerStartedAt>1400/);
  assert.match(ui,/resetScanWorker\('watchdog timeout'\)/);

  assert.match(ui,/function performanceTierFromDuration/);
  assert.match(ui,/ms>=320/);
  assert.match(ui,/scanDecodePlan/);
  assert.match(ui,/performanceTier:plan\.tier/);
  assert.match(worker,/budgetByTier/);
  assert.match(worker,/upscaleByTier/);
  assert.match(worker,/\['high','balanced','safe'\]/);

  assert.match(ui,/function applyCameraQualityProfile/);
  assert.match(ui,/frameRate:\{ideal:30,max:30\}/);
  assert.match(ui,/function scheduleCameraRecovery/);
  assert.match(ui,/track\.onended/);
  assert.match(ui,/track\.onmute/);
  assert.match(ui,/openCamera\(\{recovery:true\}\)/);

  assert.match(ui,/function validAnswerKeys/);
  assert.match(ui,/d\.invalidAnswer=!allowed\.has\(orientation\.answer\)/);
  assert.match(ui,/ĐÁP ÁN KHÔNG HỢP LỆ/);
  assert.match(ui,/if\(d\.invalidAnswer\)\{tracking\.delete\(key\);continue;\}/);

  assert.match(ui,/window\.addEventListener\('online'/);
  assert.match(ui,/if\(pendingRecords\.size\)queueFlush\(\)/);
  assert.match(ui,/navigator\.vibrate/);
  assert.match(ui,/lastCompletedFeedbackQuestionId/);
});


test('scanner visibly warns about valid QR cards that are not assigned to the current class',()=>{
  const ui=fs.readFileSync('src/qr-answer-cards-ui.js','utf8');
  assert.match(ui,/THẺ NGOÀI LỚP/);
  assert.match(ui,/strokeStyle='#dc2626'/);
  assert.match(ui,/if \(!student\) \{/);
});


test('session-state polling probes lightweight revisions before loading questions JSON and responses',()=>{
  const api=fs.readFileSync('functions/api/qr-cards.ts','utf8');
  const start=api.indexOf("if (action === 'session-state')");
  const end=api.indexOf("if (action === 'session')",start);
  const block=api.slice(start,end);
  assert.match(block,/SELECT id,creator_id,join_code,exam_id,exam_name,class_name,donvi,status,question_count/);
  assert.match(block,/if \(since && since === version\)/);
  assert.match(block,/unchanged: true/);
  const unchangedAt=block.indexOf('if (since && since === version)');
  const questionsAt=block.indexOf("SELECT questions_json");
  const responsesAt=block.indexOf("FROM qr_answer_responses");
  assert.ok(unchangedAt>=0&&questionsAt>unchangedAt,'questions_json must load only after version mismatch');
  assert.ok(responsesAt>questionsAt,'responses must load only after version mismatch');
  assert.doesNotMatch(block,/ownedSession\(db, user, admin, id\)/);
});
