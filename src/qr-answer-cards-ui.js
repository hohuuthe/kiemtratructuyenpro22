import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { buildQrCardPayload, parseQrCardPayload, answerFromQrLocation } from './qr-card-orientation.js';

const $ = id => document.getElementById(id);
let actor = null;
let wired = false;
let bootstrapData = { classes: [], exams: [], default_donvi: '' };
let roster = [];
let session = null;
let questionIndex = 0;
let stream = null;
let cameraFacing = 'environment';
let scanActive = false;
let scanTimer = null;
let frameBusy = false;
let offscreen = null;
let offctx = null;
let tracking = new Map();
let questionAnswers = new Map();
let pendingRecords = new Map();
let flushTimer = null;
let showMissingOnly = false;
let lastDetections = [];

function authToken() {
  return localStorage.getItem(window.tenantStorageKey ? window.tenantStorageKey('auth_token') : 'auth_token') || '';
}
async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(authToken() ? { Authorization: 'Bearer ' + authToken() } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({ error: 'Máy chủ không trả JSON hợp lệ.' }));
  if (!response.ok) {
    const err = Error(data.error || 'Không thể thực hiện thao tác.');
    err.code = data.code;
    err.status = response.status;
    throw err;
  }
  return data;
}
function feedback(message, error = false) {
  const el = $('qr-card-feedback');
  if (!el) return;
  el.textContent = message;
  el.className = 'rounded-xl p-3 text-sm ' + (error ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800');
}
function selectedClass() {
  const select = $('qr-card-class');
  const option = select?.selectedOptions?.[0];
  return {
    className: String(option?.dataset.className || ''),
    donvi: String(option?.dataset.donvi || '')
  };
}
function currentQuestion() {
  return session?.questions?.[questionIndex] || null;
}
function optionText(options, key) {
  if (!options) return '';
  if (Array.isArray(options)) {
    const idx = ['A','B','C','D'].indexOf(key);
    const value = options[idx];
    return typeof value === 'object' ? String(value?.text ?? value?.content ?? '') : String(value ?? '');
  }
  const value = options[key] ?? options[key.toLowerCase()] ?? options['option' + key] ?? '';
  return typeof value === 'object' ? String(value?.text ?? value?.content ?? '') : String(value ?? '');
}
function rich(value) {
  const raw = String(value ?? '');
  try {
    if (typeof window.renderScientificContent === 'function') return window.renderScientificContent(raw);
  } catch {}
  const div = document.createElement('div');
  div.textContent = raw;
  return div.innerHTML;
}
function populateBootstrap() {
  const classSelect = $('qr-card-class');
  const examSelect = $('qr-card-exam');
  if (classSelect) {
    classSelect.innerHTML = '<option value="">-- Chọn lớp --</option>' + (bootstrapData.classes || []).map((c, i) =>
      '<option value="' + i + '" data-class-name="' + esc(c.class_name) + '" data-donvi="' + esc(c.donvi || '') + '">' +
      esc((c.donvi ? c.donvi + ' · ' : '') + c.class_name) + '</option>'
    ).join('');
  }
  if (examSelect) {
    examSelect.innerHTML = '<option value="">-- Chọn đề thi --</option>' + (bootstrapData.exams || []).map(e =>
      '<option value="' + esc(e.id) + '">' + esc(e.name || e.id) + '</option>'
    ).join('');
  }
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function loadBootstrap() {
  const result = await api('GET', '/api/qr-cards?action=bootstrap');
  bootstrapData = result.data || { classes: [], exams: [] };
  populateBootstrap();
}
async function loadRoster() {
  const { className, donvi } = selectedClass();
  if (!className) {
    roster = [];
    renderRoster();
    return;
  }
  try {
    const result = await api('GET', '/api/qr-cards?action=cards&class=' + encodeURIComponent(className) + '&donvi=' + encodeURIComponent(donvi));
    roster = result.data || [];
    renderRoster();
  } catch (e) {
    roster = [];
    renderRoster();
    feedback(e.message, true);
  }
}
function renderRoster() {
  const root = $('qr-card-roster');
  const count = $('qr-card-roster-count');
  if (count) count.textContent = roster.length + ' học sinh';
  if (!root) return;
  if (!roster.length) {
    root.innerHTML = '<div class="col-span-full text-center py-4 text-slate-500">Chưa có danh sách học sinh/thẻ trong lớp này.</div>';
    return;
  }
  root.innerHTML = roster.map(s => {
    const ready = !!s.card_token && Number(s.card_active ?? 1) !== 0;
    return '<div class="rounded-xl border bg-white p-3 flex items-center gap-3 min-w-0">' +
      '<span class="w-9 h-9 shrink-0 rounded-lg grid place-items-center font-black ' + (ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800') + '">' + (ready ? '✓' : '!') + '</span>' +
      '<div class="min-w-0 flex-1"><p class="font-bold text-slate-900 truncate">' + esc(s.full_name || '') + '</p>' +
      '<p class="text-xs text-slate-500 truncate">Mã HS: ' + esc(s.student_code || s.id) + '</p></div>' +
      '<span class="text-[11px] font-bold ' + (ready ? 'text-emerald-700' : 'text-amber-700') + '">' + (ready ? 'Đã có thẻ' : 'Chưa có thẻ') + '</span></div>';
  }).join('');
}
async function ensureCards() {
  const { className, donvi } = selectedClass();
  if (!className) return feedback('Hãy chọn lớp trước.', true);
  const btn = $('qr-card-sync');
  if (btn) btn.disabled = true;
  try {
    const result = await api('POST', '/api/qr-cards', { action: 'ensure-cards', className, donvi });
    roster = result.data || [];
    renderRoster();
    feedback('Đã tạo/đồng bộ thẻ QR cho ' + roster.length + ' học sinh.');
  } catch (e) {
    feedback(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function ensureRosterForPrint() {
  const { className } = selectedClass();
  if (!className) throw Error('Hãy chọn lớp trước.');
  if (!roster.length || roster.some(s => !s.card_token)) await ensureCards();
  if (!roster.length || roster.some(s => !s.card_token)) throw Error('Không thể tạo đủ thẻ cho lớp.');
}
async function printCards() {
  const popup = window.open('', '_blank');
  if (!popup) return feedback('Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup rồi thử lại.', true);
  try { popup.opener = null; } catch {}
  try {
    popup.document.write('<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Đang tạo thẻ...</title></head><body style="font-family:Arial,sans-serif;padding:30px;text-align:center"><h2>Đang tạo bộ thẻ QR…</h2><p>Không đóng cửa sổ này.</p></body></html>');
    popup.document.close();
    await ensureRosterForPrint();
    const { className, donvi } = selectedClass();
    const prepared = await Promise.all(roster.map(async s => {
      const payload = buildQrCardPayload(s.card_token);
      const dataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'H', margin: 2, width: 440, color: { dark: '#000000', light: '#ffffff' } });
      return { ...s, dataUrl };
    }));
    const cards = prepared.map(s => `
      <article class="card">
        <div class="answer top">A</div><div class="answer right">B</div><div class="answer bottom">C</div><div class="answer left">D</div>
        <div class="identity"><strong>${escapePrint(s.full_name || '')}</strong><span>Mã HS: ${escapePrint(s.student_code || s.id)}</span><span>${escapePrint(className)}${donvi ? ' · ' + escapePrint(donvi) : ''}</span></div>
        <img class="qr" src="${s.dataUrl}" alt="QR ${escapePrint(s.student_code || s.id)}">
        <div class="brand">KTTT · Giơ thẻ với đáp án A/B/C/D quay lên trên</div>
      </article>`).join('');
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Thẻ trả lời ${escapePrint(className)}</title>
      <style>
      @page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#0f172a}
      .sheet{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.card{height:132mm;border:1.3mm solid #0f172a;border-radius:4mm;position:relative;overflow:hidden;break-inside:avoid;background:#fff}
      .qr{position:absolute;width:78mm;height:78mm;left:50%;top:53%;transform:translate(-50%,-50%);image-rendering:pixelated}
      .answer{position:absolute;font-size:14mm;font-weight:900;line-height:1;color:#0f172a;z-index:2}.top{top:4mm;left:50%;transform:translateX(-50%)}.bottom{bottom:4mm;left:50%;transform:translateX(-50%) rotate(180deg)}
      .left{left:3mm;top:50%;transform:translateY(-50%) rotate(-90deg)}.right{right:3mm;top:50%;transform:translateY(-50%) rotate(90deg)}
      .identity{position:absolute;top:13mm;left:17mm;right:17mm;text-align:center;z-index:3;background:#fff;padding:1.5mm;border-radius:2mm}.identity strong{display:block;font-size:4.5mm;text-transform:uppercase}.identity span{display:block;font-size:3.2mm;margin-top:.8mm}
      .brand{position:absolute;bottom:14mm;left:18mm;right:18mm;text-align:center;font-size:2.7mm;font-weight:700;background:#fff;padding:1mm;z-index:3}
      @media print{button{display:none}} .toolbar{grid-column:1/-1;text-align:center;margin-bottom:2mm}.toolbar button{font-size:16px;padding:10px 20px}
      </style></head><body><div class="sheet"><div class="toolbar"><button onclick="window.print()">🖨️ In thẻ A4</button></div>${cards}</div></body></html>`);
    popup.document.close();
  } catch (e) {
    try { popup.close(); } catch {}
    feedback(e.message, true);
  }
}
function escapePrint(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function startSession() {
  const { className, donvi } = selectedClass();
  const examId = $('qr-card-exam')?.value || '';
  if (!className || !examId) return feedback('Hãy chọn đúng lớp và đề thi trước khi bắt đầu.', true);
  const btn = $('qr-card-start');
  if (btn) btn.disabled = true;
  try {
    const result = await api('POST', '/api/qr-cards', { action: 'start-session', className, donvi, examId });
    session = result.data;
    questionIndex = 0;
    tracking.clear();
    questionAnswers.clear();
    pendingRecords.clear();
    $('qr-card-scan-workspace')?.classList.remove('hidden');
    renderQuestion();
    feedback('Đã tạo phiên quét. Mở camera và yêu cầu học sinh giơ thẻ.');
    setTimeout(() => $('qr-card-scan-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  } catch (e) {
    feedback(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}
function answersForQuestion(questionId) {
  if (!questionAnswers.has(String(questionId))) questionAnswers.set(String(questionId), new Map());
  return questionAnswers.get(String(questionId));
}
function renderQuestion() {
  const q = currentQuestion();
  if (!q || !session) return;
  const counter = $('qr-card-question-counter');
  if (counter) counter.textContent = 'Câu ' + (questionIndex + 1) + '/' + session.questions.length;
  const content = $('qr-card-question-content');
  if (content) content.innerHTML = rich(q.content || '');
  const options = $('qr-card-options');
  if (options) options.innerHTML = ['A','B','C','D'].map(key =>
    '<div class="rounded-xl border bg-white p-3 flex gap-2"><span class="shrink-0 w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 grid place-items-center font-black">' + key + '</span><div class="min-w-0 text-sm sm:text-base">' + rich(optionText(q.options, key)) + '</div></div>'
  ).join('');
  tracking.clear();
  updateStats();
  renderStudentStatus();
  updateNavButtons();
}
function updateNavButtons() {
  if ($('qr-card-prev-question')) $('qr-card-prev-question').disabled = questionIndex <= 0;
  if ($('qr-card-next-question')) $('qr-card-next-question').disabled = !session || questionIndex >= session.questions.length - 1;
}
function updateStats() {
  const q = currentQuestion();
  const map = q ? answersForQuestion(q.id) : new Map();
  const counts = { A:0, B:0, C:0, D:0 };
  for (const answer of map.values()) if (counts[answer] !== undefined) counts[answer]++;
  for (const k of ['A','B','C','D']) {
    const el = $('qr-card-count-' + k.toLowerCase());
    if (el) el.textContent = String(counts[k]);
  }
  if ($('qr-card-progress')) $('qr-card-progress').textContent = 'Đã nhận ' + map.size + '/' + (session?.students?.length || 0);
}
function renderStudentStatus() {
  const root = $('qr-card-student-status');
  if (!root || !session) return;
  const q = currentQuestion();
  const map = q ? answersForQuestion(q.id) : new Map();
  const rows = (session.students || []).filter(s => !showMissingOnly || !map.has(String(s.id)));
  if (!rows.length) {
    root.innerHTML = '<div class="rounded-xl bg-emerald-50 text-emerald-800 p-3 text-center font-bold">Đã nhận đủ học sinh.</div>';
    return;
  }
  root.innerHTML = rows.map(s => {
    const answer = map.get(String(s.id));
    return '<div class="rounded-xl border bg-white p-2.5 flex items-center gap-2">' +
      '<span class="w-9 h-9 rounded-lg grid place-items-center shrink-0 font-black ' + (answer ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500') + '">' + (answer || '…') + '</span>' +
      '<div class="min-w-0 flex-1"><p class="font-bold truncate">' + esc(s.full_name) + '</p><p class="text-xs text-slate-500 truncate">' + esc(s.student_code) + '</p></div>' +
      (answer ? '<button type="button" data-qr-clear="' + esc(s.id) + '" class="rounded-lg border px-2 py-1 text-xs text-slate-500">Sửa</button>' : '') + '</div>';
  }).join('');
}
function stopCamera() {
  scanActive = false;
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  if (stream) {
    for (const track of stream.getTracks()) try { track.stop(); } catch {}
    stream = null;
  }
  const video = $('qr-card-video');
  if (video) video.srcObject = null;
  $('qr-card-stop-camera')?.classList.add('hidden');
  if ($('qr-card-camera-status')) $('qr-card-camera-status').textContent = 'Camera đã dừng';
  if ($('qr-card-camera-empty')) $('qr-card-camera-empty').classList.remove('hidden');
  clearOverlay();
}
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return feedback('Trình duyệt này không hỗ trợ camera web.', true);
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: cameraFacing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
    const video = $('qr-card-video');
    video.srcObject = stream;
    await video.play();
    scanActive = true;
    $('qr-card-stop-camera')?.classList.remove('hidden');
    $('qr-card-camera-empty')?.classList.add('hidden');
    if ($('qr-card-camera-status')) $('qr-card-camera-status').textContent = cameraFacing === 'environment' ? 'Camera sau · đang quét' : 'Camera trước · đang quét';
    scheduleScan(0);
  } catch (e) {
    feedback('Không thể mở camera: ' + (e?.message || 'hãy kiểm tra quyền camera.'), true);
  }
}
function scheduleScan(delay = 115) {
  if (!scanActive) return;
  scanTimer = setTimeout(scanFrame, delay);
}
function ensureOffscreen(width, height) {
  if (!offscreen) {
    offscreen = document.createElement('canvas');
    offctx = offscreen.getContext('2d', { willReadFrequently: true });
  }
  if (offscreen.width !== width) offscreen.width = width;
  if (offscreen.height !== height) offscreen.height = height;
}
function decodeMultiple(imageData, maxCodes = 16) {
  const detections = [];
  const working = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  for (let i = 0; i < maxCodes; i++) {
    const qr = jsQR(working.data, working.width, working.height, { inversionAttempts: 'dontInvert' });
    if (!qr?.data || !qr?.location) break;
    const parsed = parseQrCardPayload(qr.data);
    if (parsed) detections.push({ ...qr, cardToken: parsed.cardToken });
    const pts = [qr.location.topLeftCorner, qr.location.topRightCorner, qr.location.bottomRightCorner, qr.location.bottomLeftCorner].filter(Boolean);
    if (!pts.length) break;
    const pad = 12;
    const minX = Math.max(0, Math.floor(Math.min(...pts.map(p => p.x)) - pad));
    const maxX = Math.min(working.width - 1, Math.ceil(Math.max(...pts.map(p => p.x)) + pad));
    const minY = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)) - pad));
    const maxY = Math.min(working.height - 1, Math.ceil(Math.max(...pts.map(p => p.y)) + pad));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const idx = (y * working.width + x) * 4;
      working.data[idx] = working.data[idx+1] = working.data[idx+2] = 255;
      working.data[idx+3] = 255;
    }
  }
  return detections;
}
async function scanFrame() {
  if (!scanActive || frameBusy || !session || !currentQuestion()) return scheduleScan();
  const video = $('qr-card-video');
  if (!video || video.readyState < 2 || !video.videoWidth) return scheduleScan();
  frameBusy = true;
  try {
    const maxW = 960;
    const scale = Math.min(1, maxW / video.videoWidth);
    const w = Math.max(320, Math.round(video.videoWidth * scale));
    const h = Math.max(180, Math.round(video.videoHeight * scale));
    ensureOffscreen(w, h);
    offctx.drawImage(video, 0, 0, w, h);
    const image = offctx.getImageData(0, 0, w, h);
    const detections = decodeMultiple(image);
    lastDetections = detections;
    processDetections(detections);
    drawOverlay(detections, w, h);
    if ($('qr-card-fps-status')) $('qr-card-fps-status').textContent = detections.length + ' thẻ trong khung';
  } catch (e) {
    console.warn('QR scan frame error', e);
  } finally {
    frameBusy = false;
    scheduleScan();
  }
}
function processDetections(detections) {
  const q = currentQuestion();
  if (!q || !session) return;
  const validStudents = new Map((session.students || []).map(s => [String(s.card_token), s]));
  const seen = new Set();
  const now = performance.now();
  for (const d of detections) {
    const student = validStudents.get(String(d.cardToken));
    if (!student) continue;
    const orientation = answerFromQrLocation(d.location);
    if (!orientation) continue;
    const key = String(q.id) + '|' + String(d.cardToken);
    seen.add(key);
    const prev = tracking.get(key);
    const same = prev?.answer === orientation.answer && now - Number(prev?.lastSeen || 0) < 900;
    const hits = same ? Number(prev.hits || 0) + 1 : 1;
    const next = { answer: orientation.answer, hits, lastSeen: now, studentId: String(student.id), cardToken: d.cardToken, location: d.location };
    tracking.set(key, next);
    if (hits >= 3) acceptStableAnswer(q.id, student, orientation.answer, hits);
  }
  for (const [key, value] of tracking) {
    if (!seen.has(key) && now - Number(value.lastSeen || 0) > 1200) tracking.delete(key);
  }
}
function acceptStableAnswer(questionId, student, answer, hits) {
  const map = answersForQuestion(questionId);
  const uid = String(student.id);
  const old = map.get(uid);
  if (old === answer) return;
  map.set(uid, answer);
  pendingRecords.set(String(questionId) + '|' + uid, {
    questionId: String(questionId),
    cardToken: String(student.card_token),
    answer,
    stableHits: Math.max(3, hits)
  });
  updateStats();
  renderStudentStatus();
  queueFlush();
}
function queueFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushPending, 300);
}
async function flushPending() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!session || !pendingRecords.size) return true;
  const records = [...pendingRecords.values()].slice(0, 40);
  const keys = records.map(r => String(r.questionId) + '|' + String(session.students.find(s => s.card_token === r.cardToken)?.id || ''));
  for (const r of records) {
    const student = session.students.find(s => String(s.card_token) === String(r.cardToken));
    if (student) pendingRecords.delete(String(r.questionId) + '|' + String(student.id));
  }
  try {
    await api('POST', '/api/qr-cards', { action: 'record-batch', sessionId: session.id, records });
    if (pendingRecords.size) queueFlush();
    return true;
  } catch (e) {
    for (const r of records) {
      const student = session.students.find(s => String(s.card_token) === String(r.cardToken));
      if (student) pendingRecords.set(String(r.questionId) + '|' + String(student.id), r);
    }
    feedback('Kết nối lưu đáp án tạm thời không ổn định. Hệ thống sẽ thử lại.', true);
    setTimeout(queueFlush, 900);
    return false;
  }
}
async function flushAllPending() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  let rounds = 0;
  while (pendingRecords.size && rounds < 10) {
    rounds++;
    const ok = await flushPending();
    if (!ok) throw Error('Chưa thể đồng bộ hết đáp án lên máy chủ. Hãy kiểm tra mạng rồi chốt lại.');
  }
  if (pendingRecords.size) throw Error('Còn đáp án chưa được đồng bộ; chưa thể chốt kết quả an toàn.');
}
function fitOverlay(sourceW, sourceH) {
  const wrap = $('qr-card-camera-wrap');
  const canvas = $('qr-card-overlay');
  if (!wrap || !canvas) return null;
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = Math.max(1, rect.width), cssH = Math.max(1, rect.height);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const scale = Math.min(cssW / sourceW, cssH / sourceH);
  const drawnW = sourceW * scale, drawnH = sourceH * scale;
  return { ctx, scale, ox: (cssW - drawnW) / 2, oy: (cssH - drawnH) / 2, cssW, cssH };
}
function drawOverlay(detections, sourceW, sourceH) {
  const fit = fitOverlay(sourceW, sourceH);
  if (!fit || !session) return;
  const { ctx, scale, ox, oy } = fit;
  const q = currentQuestion();
  const map = q ? answersForQuestion(q.id) : new Map();
  const students = new Map((session.students || []).map(s => [String(s.card_token), s]));
  ctx.lineWidth = 3;
  ctx.font = '700 13px system-ui,sans-serif';
  for (const d of detections) {
    const student = students.get(String(d.cardToken));
    if (!student) continue;
    const orientation = answerFromQrLocation(d.location);
    const answer = orientation?.answer || '?';
    const confirmed = map.get(String(student.id)) === answer;
    const points = [d.location.topLeftCorner,d.location.topRightCorner,d.location.bottomRightCorner,d.location.bottomLeftCorner];
    ctx.strokeStyle = confirmed ? '#22c55e' : '#f59e0b';
    ctx.fillStyle = confirmed ? 'rgba(34,197,94,.16)' : 'rgba(245,158,11,.13)';
    ctx.beginPath();
    points.forEach((p,i) => {
      const x = ox + p.x * scale, y = oy + p.y * scale;
      if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
    });
    ctx.closePath();ctx.fill();ctx.stroke();
    const x = ox + d.location.topLeftCorner.x * scale;
    const y = Math.max(18, oy + d.location.topLeftCorner.y * scale - 8);
    const label = String(student.full_name || student.student_code) + ' · ' + answer;
    const width = Math.min(260, ctx.measureText(label).width + 14);
    ctx.fillStyle = confirmed ? 'rgba(21,128,61,.92)' : 'rgba(180,83,9,.92)';
    ctx.fillRect(x, y - 17, width, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 7, y - 3, width - 10);
  }
}
function clearOverlay() {
  const canvas = $('qr-card-overlay');
  if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}
async function clearStudentAnswer(userId) {
  const q = currentQuestion();
  if (!q || !session) return;
  const uid = String(userId);
  try {
    await api('POST', '/api/qr-cards', { action: 'clear-answer', sessionId: session.id, questionId: String(q.id), userId: uid });
    const map = answersForQuestion(q.id);
    map.delete(uid);
    pendingRecords.delete(String(q.id) + '|' + uid);
    tracking.clear();
    updateStats();
    renderStudentStatus();
  } catch (e) {
    feedback(e.message, true);
  }
}
async function finalize() {
  if (!session) return;
  const run = async () => {
    const btn = $('qr-card-finalize');
    if (btn) btn.disabled = true;
    try {
      await flushAllPending();
      const result = await api('POST', '/api/qr-cards', { action: 'finalize', sessionId: session.id, confirmFinalize: true });
      stopCamera();
      feedback('Đã lưu ' + (result.data?.total_results || 0) + ' bài quét vào Quản lý kết quả.');
      window.showToast?.('Đã chốt kết quả quét thẻ thành công.', 'success');
      session = null;
      $('qr-card-scan-workspace')?.classList.add('hidden');
    } catch (e) {
      feedback(e.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  if (typeof window.showConfirmModal === 'function') {
    window.showConfirmModal('Chốt phiên quét và lưu kết quả cho các học sinh đã có đáp án? Học sinh chưa quét sẽ không bị tạo bài 0 điểm.', run);
  } else {
    await run();
  }
}
function bind() {
  if (wired || !$('qr-card-class')) return;
  wired = true;
  $('qr-card-class')?.addEventListener('change', loadRoster);
  $('qr-card-sync')?.addEventListener('click', ensureCards);
  $('qr-card-print')?.addEventListener('click', printCards);
  $('qr-card-start')?.addEventListener('click', startSession);
  $('qr-card-open-camera')?.addEventListener('click', openCamera);
  $('qr-card-stop-camera')?.addEventListener('click', stopCamera);
  $('qr-card-switch-camera')?.addEventListener('click', async () => { cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment'; await openCamera(); });
  $('qr-card-prev-question')?.addEventListener('click', () => { if (questionIndex > 0) { questionIndex--; renderQuestion(); } });
  $('qr-card-next-question')?.addEventListener('click', () => { if (session && questionIndex < session.questions.length - 1) { questionIndex++; renderQuestion(); } });
  $('qr-card-show-missing')?.addEventListener('click', () => {
    showMissingOnly = !showMissingOnly;
    $('qr-card-show-missing').textContent = showMissingOnly ? 'Hiện tất cả' : 'Chưa nhận';
    renderStudentStatus();
  });
  $('qr-card-student-status')?.addEventListener('click', e => {
    const btn = e.target.closest?.('[data-qr-clear]');
    if (btn) void clearStudentAnswer(btn.dataset.qrClear);
  });
  $('qr-card-finalize')?.addEventListener('click', finalize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  window.addEventListener('pagehide', stopCamera);
}
export async function initQrAnswerCards(user) {
  actor = user || null;
  bind();
  try {
    await loadBootstrap();
    feedback('Chọn lớp và đề thi để bắt đầu.');
  } catch (e) {
    feedback(e.message, true);
  }
}
export function connectQrAnswerCards() { bind(); }
export function resetQrAnswerCards() {
  stopCamera();
  actor = null;
  roster = [];
  session = null;
  questionIndex = 0;
  tracking.clear();
  questionAnswers.clear();
  pendingRecords.clear();
  showMissingOnly = false;
}
