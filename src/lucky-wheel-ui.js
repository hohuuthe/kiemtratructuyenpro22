import {
  classChoices, classRoster, wheelStorageKey, reconcileWheelState,
  availableStudents, randomWheelIndex, nextWheelRotation, finishPendingWheelResult
} from './lucky-wheel-core.js';

let active = null;
const $ = (root, id) => root.querySelector('#' + id);
const notify = (message, type = 'info') => {
  if (typeof window.showToast === 'function') window.showToast(message, type);
};
const isStaff = () => Boolean(window.currentUser && (window.isAdminLoggedIn || window.isTeacherLoggedIn));
const tenantKey = () => window.__CURRENT_TENANT_SLUG ||
  (window.location.hostname + window.location.pathname.split('/').slice(0, 2).join('/'));
const currentIdentity = () => {
  const user = window.currentUser || {};
  const id = String(user.id || user.user_id || '').trim();
  return id ? { id, tenant: tenantKey(), isAdmin: Boolean(window.isAdminLoggedIn) } : null;
};
const localRead = key => {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
};
const localWrite = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { notify('Không thể lưu tiến trình vào bộ nhớ trình duyệt. Kiểm tra dung lượng hoặc chế độ riêng tư.', 'warning'); return false; }
};
const emptyState = () => ({ excluded: [], called: [], history: [], pendingId: null, lastId: null });

class WheelSound {
  constructor(namespace) {
    this.namespace = namespace;
    this.volume = .65;
    this.muted = false;
    this.ctx = null;
    this.timer = null;
    this.audio = null;
    this.objectUrl = null;
    this.sounds = {};
  }
  async openStore() {
    if (!('indexedDB' in window)) throw new Error('Trình duyệt không hỗ trợ lưu nhạc riêng.');
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('kttt-lucky-wheel-audio-v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('tracks', { keyPath: 'key' });
      req.onerror = () => reject(req.error || Error('Không thể mở bộ nhớ âm thanh.'));
      req.onsuccess = () => resolve(req.result);
    });
  }
  async dbAction(mode, callback) {
    const db = await this.openStore();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('tracks', mode);
        const request = callback(tx.objectStore('tracks'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || Error('Lưu hoặc đọc nhạc thất bại.'));
        tx.onerror = () => reject(tx.error || Error('Giao dịch nhạc thất bại.'));
      });
    } finally { db.close(); }
  }
  key(kind) { return this.namespace + ':' + kind; }
  async restore() {
    for (const kind of ['spin', 'applause']) {
      try { this.sounds[kind] = await this.dbAction('readonly', store => store.get(this.key(kind))) || null; }
      catch { this.sounds[kind] = null; }
    }
  }
  async save(kind, file) {
    if (!file || file.size <= 0 || file.size > 15 * 1024 * 1024) throw new Error('Mỗi nhạc tải lên phải từ 1 byte đến tối đa 15 MB.');
    if (!/\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name) ||
        (file.type && !file.type.startsWith('audio/') && file.type !== 'application/ogg')) {
      throw new Error('Chỉ chấp nhận tệp âm thanh MP3, WAV, OGG, M4A hoặc AAC.');
    }
    const item = { key: this.key(kind), blob: file, name: file.name, mime: file.type || '' };
    await this.dbAction('readwrite', store => store.put(item));
    this.sounds[kind] = item;
  }
  async clear(kind) {
    await this.dbAction('readwrite', store => store.delete(this.key(kind)));
    this.sounds[kind] = null;
  }
  get context() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    return this.ctx;
  }
  tone(freq, when, length = .14, wave = 'triangle', amplitude = .22) {
    const ctx = this.context;
    if (!ctx || this.muted || this.volume === 0) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = wave; o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002, amplitude * this.volume), when + .012);
    g.gain.exponentialRampToValueAtTime(.0001, when + length);
    o.connect(g); g.connect(ctx.destination); o.start(when); o.stop(when + length + .01);
  }
  async start(kind, preview = false) {
    this.stop();
    if (this.muted || this.volume === 0) return;
    const custom = this.sounds[kind];
    if (custom?.blob) {
      this.objectUrl = URL.createObjectURL(custom.blob);
      this.audio = new Audio(this.objectUrl);
      this.audio.volume = this.volume;
      this.audio.loop = kind === 'spin' && !preview;
      try { await this.audio.play(); }
      catch { notify('Trình duyệt không phát được nhạc đã chọn; đang dùng hiệu ứng mặc định.', 'warning'); this.stop(); this.startGenerated(kind, preview); }
    } else this.startGenerated(kind, preview);
  }
  startGenerated(kind, preview) {
    const ctx = this.context;
    if (!ctx || this.muted) return;
    void ctx.resume();
    if (kind === 'applause') { this.applause(); return; }
    const melody = [523.25,659.25,783.99,1046.5,783.99,880,987.77,659.25,587.33,783.99,880,1174.66,987.77,880,783.99,659.25];
    let step = 0;
    const play = () => {
      if (this.muted) return;
      const now = ctx.currentTime;
      this.tone(melody[step % melody.length], now, .14, 'triangle', .20);
      if (step % 4 === 0) this.tone(melody[step % melody.length] / 2, now, .19, 'sine', .15);
      step++;
      if (preview && step >= 14) this.stop();
    };
    play();
    this.timer = setInterval(play, 190);
  }
  applause() {
    const ctx = this.context;
    if (!ctx || this.muted) return;
    const sampleSize = Math.ceil(ctx.sampleRate * .05), buffer = ctx.createBuffer(1, sampleSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const start = ctx.currentTime + .01;
    for (let i = 0; i < 64; i++) {
      const t = start + i * .035 + Math.random() * .015;
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), volume = ctx.createGain();
      source.buffer = buffer; filter.type = 'highpass'; filter.frequency.value = 600;
      volume.gain.value = this.volume * (.07 + Math.random() * .08);
      source.connect(filter); filter.connect(volume); volume.connect(ctx.destination);
      source.start(t);
    }
    [784,988,1175,1568].forEach((note, i) => this.tone(note, start + i * .12, .25, 'sine', .20));
  }
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.audio) {
      this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = null;
    }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
  }
  dispose() { this.stop(); if (this.ctx) { void this.ctx.close().catch(() => {}); this.ctx = null; } }
}

function renderWheel(canvas, participants, angle = 0) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, mid = w / 2, radius = w * .47;
  ctx.clearRect(0, 0, w, w);
  ctx.save(); ctx.translate(mid, mid);
  ctx.fillStyle = '#f8d66d'; ctx.beginPath(); ctx.arc(0, 0, radius + 11, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.rotate(angle);
  const count = participants.length;
  if (!count) {
    ctx.fillStyle = '#283a79'; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'white'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('HÃY CHỌN LỚP', 0, -75);
  } else {
    const size = Math.PI * 2 / count, palette = ['#ff6a75','#ffce62','#39beb4','#5f8ceb','#a476e8','#f48ab7','#79c76a','#ee9c45'];
    for (let i = 0; i < count; i++) {
      const center = -Math.PI / 2 + i * size, start = center - size / 2;
      ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,radius,start,start+size); ctx.closePath();
      ctx.fillStyle = palette[i % palette.length]; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = count > 28 ? 1.5 : 3; ctx.stroke();
      ctx.save(); ctx.rotate(center); ctx.translate(radius * .75, 0);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#152143'; ctx.font = '900 ' + (count > 40 ? 22 : count > 25 ? 26 : 32) + 'px sans-serif';
      ctx.fillText(String(i + 1).padStart(2, '0'), 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

class ClassroomWheel {
  constructor(root, identity) {
    this.root = root;
    this.identity = identity;
    this.active = true;
    this.choices = [];
    this.roster = [];
    this.state = emptyState();
    this.classKey = '';
    this.angle = 0;
    this.spinning = false;
    this.raf = 0;
    this.previewTimer = 0;
    this.sound = new WheelSound(wheelStorageKey({ tenant: identity.tenant, teacherId: identity.id, kind: 'audio' }));
    this.soundKey = wheelStorageKey({ tenant: identity.tenant, teacherId: identity.id, kind: 'preferences' });
    this.onStorage = e => {
      if (e.key !== this.classKey || !this.active) return;
      if (this.spinning) {
        this.setNotice('Danh sách đã thay đổi ở một tab khác. Hoàn tất lượt quay trước khi đồng bộ.', 'warning');
        return;
      }
      this.state = reconcileWheelState(localRead(this.classKey), this.roster);
      this.draw(); this.renderList();
    };
    window.addEventListener('storage', this.onStorage);
    this.bind();
  }
  el(id) { return $(this.root, id); }
  setNotice(message, type = 'info') {
    const el = this.el('lw-notice');
    if (el) { el.textContent = message; el.dataset.type = type; }
  }
  saveState() {
    if (this.classKey) localWrite(this.classKey, this.state);
  }
  setControls() {
    const pending = availableStudents(this.roster, this.state);
    this.el('lw-total').textContent = String(this.roster.length);
    this.el('lw-available').textContent = String(pending.length);
    this.el('lw-called').textContent = String(this.state.called.length);
    this.el('lw-selected').textContent = (this.roster.length - this.state.excluded.length) + '/' + this.roster.length;
    this.el('lw-spin').disabled = this.spinning || !pending.length;
    for (const id of ['lw-class','lw-refresh','lw-select-all','lw-exclude-all','lw-reset']) this.el(id).disabled = this.spinning;
  }
  draw(list = availableStudents(this.roster, this.state), angle = this.angle) {
    renderWheel(this.el('lw-canvas'), list, angle);
    this.setControls();
  }
  renderList() {
    const list = this.el('lw-roster');
    list.replaceChildren();
    const term = this.el('lw-search').value.trim().toLocaleLowerCase('vi');
    const called = new Set(this.state.called), excluded = new Set(this.state.excluded);
    for (const [index, student] of this.roster.entries()) {
      if (term && !student.name.toLocaleLowerCase('vi').includes(term)) continue;
      const label = document.createElement('label');
      label.className = 'lw-student' + (called.has(student.id) ? ' lw-was-called' : '');
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !excluded.has(student.id);
      input.disabled = this.spinning;
      input.addEventListener('change', () => {
        this.state.excluded = input.checked ? this.state.excluded.filter(id => id !== student.id)
          : [...new Set([...this.state.excluded, student.id])];
        this.saveState(); this.draw(); this.renderList();
      });
      const text = document.createElement('span'); text.textContent = String(index + 1).padStart(2, '0') + '. ' + student.name;
      label.append(input, text);
      if (called.has(student.id)) {
        const badge = document.createElement('small'); badge.textContent = 'Đã gọi'; label.append(badge);
      }
      list.append(label);
    }
    if (!list.childNodes.length) {
      const empty = document.createElement('p'); empty.className = 'lw-empty';
      empty.textContent = this.roster.length ? 'Không có tên phù hợp.' : 'Chưa có học sinh trong lớp này.';
      list.append(empty);
    }
    const history = this.el('lw-history'); history.replaceChildren();
    for (const id of this.state.history) {
      const student = this.roster.find(s => s.id === id);
      if (!student) continue;
      const li = document.createElement('li'); li.textContent = student.name; history.append(li);
    }
    if (!history.childNodes.length) {
      const li = document.createElement('li'); li.textContent = 'Chưa có học sinh nào được gọi.'; history.append(li);
    }
    this.setControls();
  }
  setClass(choice) {
    this.stopSpin();
    this.roster = classRoster(window.usersList, window.currentTeacherAssignments, this.identity.isAdmin, choice.unit, choice.className);
    this.classKey = wheelStorageKey({ tenant: this.identity.tenant, teacherId: this.identity.id,
      unit: choice.unit, className: choice.className });
    this.state = reconcileWheelState(localRead(this.classKey), this.roster);
    if (this.state.pendingId) {
      this.state = finishPendingWheelResult(this.state);
      this.saveState();
      this.setNotice('Đã phục hồi kết quả lượt quay bị gián đoạn; không bốc lại học sinh.', 'warning');
    } else this.setNotice('Danh sách ' + choice.className + ' • ' + choice.unit + ' đã sẵn sàng.');
    this.angle = 0;
    this.el('lw-result').textContent = this.state.lastId
      ? '🎉 ' + (this.roster.find(s => s.id === this.state.lastId)?.name || 'Đã có kết quả')
      : '✨ Sẵn sàng gọi tên học sinh';
    this.el('lw-search').value = '';
    this.draw(); this.renderList();
  }
  async load(force = false) {
    this.stopSpin();
    if (!isStaff()) { this.setNotice('Chỉ giáo viên và quản trị viên được sử dụng trò chơi.', 'error'); return; }
    if (force || !window.__coreIdentitySnapshot?.complete) {
      this.setNotice('Đang tải và xác minh danh sách học sinh theo phân quyền...');
      if (typeof window.preloadRoleScopedIdentityOnLogin !== 'function') {
        this.setNotice('Không có chức năng tải danh sách theo vai trò.', 'error'); return;
      }
      try { await window.preloadRoleScopedIdentityOnLogin(); }
      catch (error) { this.setNotice('Không thể xác minh danh sách: ' + error.message, 'error'); return; }
    }
    if (!this.active || !isStaff() ||
        String(window.currentUser?.id || window.currentUser?.user_id || '') !== this.identity.id) return;
    const snapshot = window.__coreIdentitySnapshot;
    if (!snapshot?.complete || snapshot.userId !== this.identity.id) {
      this.setNotice('Dữ liệu phiên đăng nhập chưa được xác minh đầy đủ.', 'error'); return;
    }
    const list = Array.isArray(window.usersList) ? window.usersList : [];
    const assigns = Array.isArray(window.currentTeacherAssignments) ? window.currentTeacherAssignments : [];
    const saved = this.el('lw-class').value;
    const current = this.choices.find(item => item.key === saved);
    this.choices = classChoices(list, assigns, this.identity.isAdmin);
    const selector = this.el('lw-class'); selector.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Chọn lớp học'; selector.append(empty);
    for (const choice of this.choices) {
      const option = document.createElement('option'); option.value = choice.key;
      option.textContent = choice.className + ' — ' + choice.unit;
      selector.append(option);
    }
    const next = this.choices.find(item => item.key === current?.key) || this.choices[0];
    if (next) { selector.value = next.key; this.setClass(next); }
    else {
      this.roster = []; this.state = emptyState(); this.classKey = '';
      this.el('lw-result').textContent = 'Chưa có lớp học hợp lệ';
      this.setNotice('Chưa có lớp được phân công hoặc lớp chưa có hồ sơ học sinh.', 'warning');
      this.draw(); this.renderList();
    }
  }
  stopSpin() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.spinning = false;
    this.sound.stop();
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = 0; }
  }
  async spin() {
    if (this.spinning || !this.classKey) return;
    const students = availableStudents(this.roster, this.state);
    if (!students.length) { this.setNotice('Đã gọi hết học sinh hợp lệ. Hãy bắt đầu vòng mới hoặc chọn thêm học sinh.', 'warning'); return; }
    const stored = reconcileWheelState(localRead(this.classKey), this.roster);
    if (JSON.stringify(stored) !== JSON.stringify(this.state)) {
      this.state = stored; this.draw(); this.renderList();
      this.setNotice('Dữ liệu lớp vừa thay đổi. Hãy kiểm tra danh sách trước khi quay.', 'warning'); return;
    }
    const index = randomWheelIndex(students.length);
    const winner = students[index];
    this.state.pendingId = winner.id;
    if (!localWrite(this.classKey, this.state)) {
      this.state.pendingId = null; this.setNotice('Không thể lưu lượt quay an toàn. Vui lòng kiểm tra bộ nhớ trình duyệt.', 'error'); return;
    }
    this.spinning = true; this.setControls(); this.renderList();
    this.el('lw-result').textContent = '🎶 Đang quay... Chúc em may mắn!';
    this.setNotice('Vòng quay đang chạy! Hãy chờ kim dừng lại...');
    void this.sound.start('spin').catch(() => {});
    const startAngle = this.angle;
    const destination = nextWheelRotation(startAngle, index, students.length, 7);
    const start = performance.now(), duration = 6300;
    const drawFrame = time => {
      if (!this.active || !this.spinning) return;
      const t = Math.min(1, Math.max(0, (time - start) / duration));
      const eased = 1 - Math.pow(1 - t, 4);
      this.angle = startAngle + (destination - startAngle) * eased;
      renderWheel(this.el('lw-canvas'), students, this.angle);
      if (t < 1) this.raf = requestAnimationFrame(drawFrame);
      else this.finish(winner);
    };
    this.raf = requestAnimationFrame(drawFrame);
  }
  finish(winner) {
    this.raf = 0;
    this.spinning = false; this.sound.stop();
    this.state = finishPendingWheelResult(this.state);
    this.saveState();
    this.el('lw-result').textContent = '🎉 ' + winner.name + ' 🎉';
    this.setNotice('Xin chúc mừng ' + winner.name + '! Mời em tham gia.');
    this.renderList();
    this.draw();
    void this.sound.start('applause').catch(() => {});
    if (typeof window.confetti === 'function') {
      window.confetti({ particleCount: 130, spread: 80, origin: { y: .62 }, disableForReducedMotion: true });
    }
  }
  async upload(kind, file) {
    if (!file) return;
    try { await this.sound.save(kind, file); this.showTrackNames(); notify('Đã lưu nhạc riêng vào trình duyệt.', 'success'); }
    catch (error) { notify(error.message || 'Không thể lưu nhạc.', 'error'); }
    this.el(kind === 'spin' ? 'lw-spin-file' : 'lw-applause-file').value = '';
  }
  showTrackNames() {
    for (const kind of ['spin', 'applause']) {
      this.el('lw-' + kind + '-filename').textContent =
        this.sound.sounds[kind]?.name || (kind === 'spin' ? 'Nhạc vui nhộn mặc định' : 'Tiếng vỗ tay mặc định');
    }
  }
  async preview(kind) {
    this.sound.stop();
    if (this.previewTimer) clearTimeout(this.previewTimer);
    try {
      await this.sound.start(kind, true);
      this.previewTimer = setTimeout(() => this.sound.stop(), kind === 'spin' ? 3200 : 2600);
    } catch { notify('Không thể phát nhạc thử.', 'warning'); }
  }
  bind() {
    this.el('lw-class').addEventListener('change', event => {
      const choice = this.choices.find(x => x.key === event.target.value);
      if (choice) this.setClass(choice);
      else { this.roster = []; this.classKey = ''; this.state = emptyState(); this.draw(); this.renderList(); }
    });
    this.el('lw-refresh').addEventListener('click', () => void this.load(true));
    this.el('lw-spin').addEventListener('click', () => void this.spin());
    this.el('lw-search').addEventListener('input', () => this.renderList());
    this.el('lw-select-all').addEventListener('click', () => {
      this.state.excluded = []; this.saveState(); this.draw(); this.renderList();
    });
    this.el('lw-exclude-all').addEventListener('click', () => {
      this.state.excluded = this.roster.map(s => s.id); this.saveState(); this.draw(); this.renderList();
    });
    this.el('lw-reset').addEventListener('click', () => {
      if (!this.classKey) return;
      const reset = () => {
        this.state.called = []; this.state.history = []; this.state.lastId = null; this.state.pendingId = null;
        this.angle = 0; this.saveState(); this.el('lw-result').textContent = '✨ Bắt đầu vòng gọi tên mới!';
        this.setNotice('Đã bắt đầu vòng mới; giữ nguyên danh sách học sinh được chọn.');
        this.draw(); this.renderList();
      };
      if (typeof window.showConfirmModal === 'function') {
        window.showConfirmModal('Bắt đầu vòng mới và xóa lịch sử gọi tên của lớp này?', reset);
      } else reset();
    });
    this.el('lw-fullscreen').addEventListener('click', async () => {
      try {
        if (document.fullscreenElement === this.root) await document.exitFullscreen();
        else await this.root.requestFullscreen();
      } catch { notify('Không thể mở toàn màn hình trên thiết bị này.', 'warning'); }
    });
    for (const kind of ['spin', 'applause']) {
      this.el('lw-' + kind + '-file').addEventListener('change', event => void this.upload(kind, event.target.files?.[0]));
      this.el('lw-preview-' + kind).addEventListener('click', () => void this.preview(kind));
      this.el('lw-default-' + kind).addEventListener('click', async () => {
        try { this.sound.stop(); await this.sound.clear(kind); this.showTrackNames(); notify('Đã dùng lại nhạc mặc định.', 'success'); }
        catch { notify('Không thể khôi phục nhạc mặc định.', 'error'); }
      });
    }
    this.el('lw-volume').addEventListener('input', event => {
      this.sound.volume = Number(event.target.value) / 100;
      this.el('lw-volume-text').textContent = event.target.value + '%';
      if (this.sound.audio) this.sound.audio.volume = this.sound.volume;
      this.savePrefs();
    });
    this.el('lw-muted').addEventListener('change', event => {
      this.sound.muted = event.target.checked;
      if (this.sound.muted) this.sound.stop();
      this.savePrefs();
    });
    this.el('lw-sound-settings').addEventListener('toggle', () => this.sound.stop());
  }
  savePrefs() { localWrite(this.soundKey, { volume: this.sound.volume, muted: this.sound.muted }); }
  async initialize() {
    const prefs = localRead(this.soundKey);
    if (prefs && typeof prefs === 'object') {
      if (Number.isFinite(prefs.volume)) this.sound.volume = Math.max(0, Math.min(1, prefs.volume));
      this.sound.muted = prefs.muted === true;
    }
    this.el('lw-volume').value = String(Math.round(this.sound.volume * 100));
    this.el('lw-volume-text').textContent = Math.round(this.sound.volume * 100) + '%';
    this.el('lw-muted').checked = this.sound.muted;
    try { await this.sound.restore(); } catch {}
    if (!this.active) return;
    this.showTrackNames();
    await this.load();
  }
  dispose() {
    this.active = false;
    this.stopSpin();
    if (this.state.pendingId) { this.state = finishPendingWheelResult(this.state); this.saveState(); }
    window.removeEventListener('storage', this.onStorage);
    this.sound.dispose();
    if (document.fullscreenElement === this.root) void document.exitFullscreen().catch(() => {});
  }
}

export function resetLuckyWheel() {
  if (active) { active.dispose(); active = null; }
}

export function connectLuckyWheel() {
  const root = document.getElementById('lucky-wheel-root');
  if (!root || !isStaff()) return;
  const identity = currentIdentity();
  if (!identity) return;
  if (active && active.root === root && active.identity.id === identity.id && active.identity.tenant === identity.tenant) return;
  resetLuckyWheel();
  active = new ClassroomWheel(root, identity);
  void active.initialize();
}
