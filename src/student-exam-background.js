const STORAGE_SUFFIX = 'student_exam_background_v1';
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const TARGET_DATA_URL_LENGTH = 1_900_000;

function storageKey() {
  try {
    return typeof window.tenantStorageKey === 'function'
      ? window.tenantStorageKey(STORAGE_SUFFIX)
      : STORAGE_SUFFIX;
  } catch {
    return STORAGE_SUFFIX;
  }
}

function notify(message, type = 'success') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
  }
}

function examInterface() {
  return document.getElementById('exam-interface');
}

export function applyStudentExamBackground(dataUrl) {
  const root = examInterface();
  if (!root || !dataUrl) return false;
  root.style.setProperty('--student-exam-background-image', `url("${String(dataUrl).replace(/"/g, '%22')}")`);
  root.classList.add('student-background-active');
  const button = document.getElementById('btn-student-exam-background');
  if (button) {
    button.classList.add('student-background-selected');
    button.title = 'Đổi hình nền giao diện làm bài';
    button.setAttribute('aria-label', 'Đổi hình nền giao diện làm bài');
  }
  return true;
}

export function clearStudentExamBackground() {
  const root = examInterface();
  if (root) {
    root.style.removeProperty('--student-exam-background-image');
    root.classList.remove('student-background-active');
  }
  const button = document.getElementById('btn-student-exam-background');
  if (button) {
    button.classList.remove('student-background-selected');
    button.title = 'Chọn hình nền giao diện làm bài';
    button.setAttribute('aria-label', 'Chọn hình nền giao diện làm bài');
  }
  try { localStorage.removeItem(storageKey()); } catch {}
}

function restoreBackground() {
  try {
    const saved = localStorage.getItem(storageKey());
    if (saved) applyStudentExamBackground(saved);
  } catch {}
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không đọc được hình ảnh.'));
    };
    image.src = url;
  });
}

async function compressBackgroundImage(file) {
  const image = await loadImage(file);
  const longest = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const attempts = [
    { edge: 1920, quality: 0.86 },
    { edge: 1600, quality: 0.78 },
    { edge: 1280, quality: 0.72 },
    { edge: 1080, quality: 0.66 }
  ];

  let best = '';
  for (const attempt of attempts) {
    const scale = Math.min(1, attempt.edge / Math.max(1, longest));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý hình nền.');
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    let dataUrl = canvas.toDataURL('image/webp', attempt.quality);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', attempt.quality);
    }
    best = dataUrl;
    if (dataUrl.length <= TARGET_DATA_URL_LENGTH) break;
  }
  return best;
}

let pickerState = null;

function finishPicker() {
  const state = pickerState;
  if (!state) return;
  pickerState = null;
  window.studentBackgroundPickerActive = false;
  window.intentionalFullscreenExit = state.previousIntentional;

  if (state.wasFullscreen && !document.fullscreenElement) {
    setTimeout(async () => {
      const root = examInterface();
      const examActive = root && !root.classList.contains('hidden');
      if (!examActive) return;
      try {
        const restored = typeof window.enterExamFullscreen === 'function'
          ? await window.enterExamFullscreen()
          : false;
        if (!restored && typeof window.showFullscreenEnforcer === 'function') {
          window.showFullscreenEnforcer();
        }
      } catch {
        if (typeof window.showFullscreenEnforcer === 'function') {
          window.showFullscreenEnforcer();
        }
      }
    }, 120);
  }
}

async function handleSelectedFile(file) {
  if (!file) return;
  if (!String(file.type || '').startsWith('image/')) {
    notify('Vui lòng chọn đúng tệp hình ảnh.', 'warning');
    return;
  }
  if (file.size > MAX_SOURCE_BYTES) {
    notify('Hình nền quá lớn. Vui lòng chọn ảnh nhỏ hơn 12 MB.', 'warning');
    return;
  }

  try {
    const dataUrl = await compressBackgroundImage(file);
    if (!dataUrl) throw new Error('Không tạo được hình nền.');
    applyStudentExamBackground(dataUrl);
    try {
      localStorage.setItem(storageKey(), dataUrl);
      notify('Đã đặt hình nền cho giao diện làm bài.', 'success');
    } catch {
      notify('Đã đặt hình nền cho lần làm bài hiện tại. Bộ nhớ trình duyệt không đủ để lưu lâu dài.', 'warning');
    }
  } catch (error) {
    console.warn('[StudentBackground] Cannot process image:', error);
    notify('Không thể sử dụng ảnh này làm hình nền. Hãy thử ảnh khác.', 'error');
  }
}

function wireInput() {
  const input = document.getElementById('student-exam-background-input');
  if (!input || input.dataset.backgroundWired === '1') return false;
  input.dataset.backgroundWired = '1';

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    await handleSelectedFile(file);
    input.value = '';
    finishPicker();
  });

  input.addEventListener('cancel', finishPicker);
  return true;
}

export function openStudentExamBackgroundPicker() {
  const input = document.getElementById('student-exam-background-input');
  if (!input) {
    notify('Chức năng hình nền chưa sẵn sàng.', 'warning');
    return;
  }
  wireInput();

  pickerState = {
    wasFullscreen: Boolean(document.fullscreenElement),
    previousIntentional: Boolean(window.intentionalFullscreenExit)
  };
  window.studentBackgroundPickerActive = true;
  if (pickerState.wasFullscreen) window.intentionalFullscreenExit = true;

  input.value = '';
  input.click();

  // Some browsers do not dispatch the cancel event. Focus returning to the
  // page is a safe fallback; the delay lets the change event run first.
  window.addEventListener('focus', () => {
    setTimeout(() => {
      if (window.studentBackgroundPickerActive && !(input.files && input.files.length)) {
        finishPicker();
      }
    }, 500);
  }, { once: true });
}

window.openStudentExamBackgroundPicker = openStudentExamBackgroundPicker;
window.clearStudentExamBackground = clearStudentExamBackground;

function initStudentBackground() {
  if (!wireInput()) {
    const observer = new MutationObserver(() => {
      if (wireInput()) {
        restoreBackground();
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
  } else {
    restoreBackground();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStudentBackground, { once: true });
} else {
  initStudentBackground();
}
