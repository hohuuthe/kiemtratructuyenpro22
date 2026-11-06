const CURRENT_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined'
  ? String(__APP_BUILD_ID__)
  : (document.querySelector('meta[name="app-release"]')?.getAttribute('content') || 'unknown');

const VERSION_URL = '/version.json';
const CHECK_INTERVAL_MS = 120_000;
const SAFE_RECHECK_MS = 5_000;
const RECENT_EDIT_GRACE_MS = 45_000;
const IDLE_BEFORE_PROMPT_MS = 8_000;
const STARTUP_FETCH_TIMEOUT_MS = 3_500;
const RELOAD_LOOP_GUARD_MS = 20_000;

let pendingVersion = null;
let updateModalOpen = false;
let lastUserActivityAt = Date.now();
let lastEditAt = 0;
let monitorTimer = null;
let safeRecheckTimer = null;
let versionChannel = null;
let lastVersionCheckAt = 0;

function isVisible(element) {
  if (!element || !element.isConnected) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function textOf(element) {
  return String(element?.textContent || element?.innerText || '').replace(/\s+/g, ' ').trim();
}

function hasVisibleSubmitExamControl() {
  const directSelectors = [
    '#submit-exam-btn',
    '#btn-submit-exam',
    '[data-action="submit-exam"]',
    '[data-exam-submit]',
    'button[onclick*="submitExam"]',
    'button[onclick*="submitTest"]',
    'button[onclick*="finishExam"]',
    'button[onclick*="nopBai"]'
  ];

  if (directSelectors.some((selector) => {
    try {
      return Array.from(document.querySelectorAll(selector)).some(isVisible);
    } catch (_) {
      return false;
    }
  })) {
    return true;
  }

  return Array.from(document.querySelectorAll('button, [role="button"]')).some((element) => {
    if (!isVisible(element)) return false;
    const label = textOf(element).toLowerCase();
    return (
      (label === 'nộp bài' || label.includes('nộp bài thi') || label.includes('kết thúc bài thi')) &&
      !label.includes('đã nộp')
    );
  });
}

export function isStudentExamInProgress() {
  if (window.__APP_CRITICAL_ACTIVITY__?.studentExam === true) return true;
  if (window.__ACTIVE_STUDENT_EXAM_SESSION__ === true) return true;
  if (document.documentElement.dataset.studentExamInProgress === 'true') return true;
  if (document.body?.dataset.studentExamInProgress === 'true') return true;

  const activeExamSelectors = [
    '#exam-interface',
    '[data-exam-in-progress="true"]',
    '[data-student-exam-active="true"]',
    '#student-exam-active',
    '#student-exam-container.exam-active',
    '#exam-taking-container',
    '.student-exam-taking',
    '.exam-taking-mode'
  ];

  const hasExplicitActiveExam = activeExamSelectors.some((selector) => {
    try {
      return Array.from(document.querySelectorAll(selector)).some(isVisible);
    } catch (_) {
      return false;
    }
  });

  return hasExplicitActiveExam || hasVisibleSubmitExamControl();
}

function hasVisibleBlockingModal() {
  const roots = [
    '#modal-container',
    '#account-modal',
    '#user-modal',
    '#pwa-modal-root'
  ];

  for (const selector of roots) {
    const root = document.querySelector(selector);
    if (root && Array.from(root.children).some(isVisible)) return true;
  }

  const versionModalRoot = document.getElementById('app-version-update-modal');

  return Array.from(document.querySelectorAll('[role="dialog"], dialog[open], .modal:not(.hidden)'))
    .some((element) => {
      if (versionModalRoot && (element === versionModalRoot || versionModalRoot.contains(element))) {
        return false;
      }
      return isVisible(element);
    });
}

function isEditableElement(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = String(element.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return false;
  const type = String(element.type || 'text').toLowerCase();
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file'].includes(type);
}

function hasCriticalActivity() {
  const activities = window.__APP_CRITICAL_ACTIVITY__;
  return !!activities && Object.values(activities).some(Boolean);
}

function hasFilesSelected() {
  return Array.from(document.querySelectorAll('input[type="file"]')).some((input) =>
    isVisible(input) && input.files && input.files.length > 0
  );
}

export function isUnsafeForVersionPrompt() {
  if (isStudentExamInProgress()) return true;
  if (hasCriticalActivity()) return true;
  if (document.hidden) return true;
  if (document.fullscreenElement) return true;
  if (hasVisibleBlockingModal()) return true;
  if (hasFilesSelected()) return true;
  if (isEditableElement(document.activeElement)) return true;
  if (Date.now() - lastEditAt < RECENT_EDIT_GRACE_MS) return true;
  return false;
}

async function fetchLatestVersion() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), STARTUP_FETCH_TIMEOUT_MS);
  try {
    const separator = VERSION_URL.includes('?') ? '&' : '?';
    const response = await fetch(`${VERSION_URL}${separator}t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || !data.version) return null;
    return {
      version: String(data.version),
      buildTime: data.buildTime ? String(data.buildTime) : '',
      buildIso: data.buildIso ? String(data.buildIso) : ''
    };
  } catch (_) {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestServiceWorkerUpdate() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;
    await Promise.race([
      registration.update(),
      new Promise((resolve) => window.setTimeout(resolve, 1_000))
    ]);
  } catch (_) {
    // Không chặn reload nếu SW không cập nhật được.
  }
}

function cleanupReloadQuery() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('__appv') && !url.searchParams.has('__reload')) return;
    url.searchParams.delete('__appv');
    url.searchParams.delete('__reload');
    window.history.replaceState(window.history.state, '', url.toString());
  } catch (_) {}
}

async function navigateToLatestVersion(version, source) {
  window.dispatchEvent(new CustomEvent('app:before-version-reload', {
    detail: { version, source }
  }));

  await requestServiceWorkerUpdate();

  const url = new URL(window.location.href);
  url.searchParams.set('__appv', version);
  url.searchParams.set('__reload', String(Date.now()));
  window.location.replace(url.toString());
}

function markReloadAttempt(version) {
  try {
    sessionStorage.setItem('app-version:last-reload-target', version);
    sessionStorage.setItem('app-version:last-reload-at', String(Date.now()));
  } catch (_) {}
}

function wasReloadJustAttempted(version) {
  try {
    const target = sessionStorage.getItem('app-version:last-reload-target');
    const at = Number(sessionStorage.getItem('app-version:last-reload-at') || 0);
    return target === version && Date.now() - at < RELOAD_LOOP_GUARD_MS;
  } catch (_) {
    return false;
  }
}

function setPendingVersion(versionInfo) {
  if (!versionInfo || versionInfo.version === CURRENT_BUILD_ID) return;
  pendingVersion = versionInfo;

  try {
    versionChannel?.postMessage({
      type: 'NEW_APP_VERSION',
      versionInfo
    });
  } catch (_) {}

  scheduleSafePrompt();
}

function wasDismissedThisSession(version) {
  try {
    return sessionStorage.getItem('app-version:dismissed') === version;
  } catch (_) {
    return false;
  }
}

function dismissVersion(version) {
  try {
    sessionStorage.setItem('app-version:dismissed', version);
  } catch (_) {}
}

function ensureUpdateModalRoot() {
  let root = document.getElementById('app-version-update-modal');
  if (!root) {
    root = document.createElement('div');
    root.id = 'app-version-update-modal';
    document.body.appendChild(root);
  }
  return root;
}

function closeUpdateModal({ dismissed = false } = {}) {
  const version = pendingVersion?.version;
  const root = document.getElementById('app-version-update-modal');
  if (root) root.replaceChildren();
  updateModalOpen = false;
  if (dismissed && version) {
    dismissVersion(version);
  }
}

function showUpdateModal() {
  if (!pendingVersion || updateModalOpen) return;
  if (wasDismissedThisSession(pendingVersion.version)) return;
  if (isUnsafeForVersionPrompt()) {
    scheduleSafePrompt();
    return;
  }

  updateModalOpen = true;
  const root = ensureUpdateModalRoot();

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[99999] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4';
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-labelledby', 'app-version-title');

  const card = document.createElement('div');
  card.className = 'w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xl sm:p-6';

  const icon = document.createElement('div');
  icon.className = 'mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl';
  icon.textContent = '🔄';

  const title = document.createElement('h2');
  title.id = 'app-version-title';
  title.className = 'text-center text-lg font-black text-slate-900';
  title.textContent = 'Đã có phiên bản mới';

  const message = document.createElement('p');
  message.className = 'mt-2 text-center text-sm leading-6 text-slate-600';
  message.textContent = 'Hệ thống đã có phiên bản mới. Bạn có thể tải lại trang để cập nhật ngay hoặc đóng thông báo và tiếp tục công việc hiện tại.';

  const safety = document.createElement('p');
  safety.className = 'mt-3 rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-semibold leading-5 text-amber-800';
  safety.textContent = 'Chỉ tải lại khi bạn đã hoàn tất hoặc lưu công việc đang thực hiện. Hệ thống không tự tải lại giữa phiên làm việc.';

  const actions = document.createElement('div');
  actions.className = 'mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50';
  closeButton.textContent = 'Đóng';
  closeButton.addEventListener('click', () => closeUpdateModal({ dismissed: true }));

  const reloadButton = document.createElement('button');
  reloadButton.type = 'button';
  reloadButton.className = 'rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]';
  reloadButton.textContent = 'Khởi động lại';
  reloadButton.addEventListener('click', async () => {
    if (!pendingVersion || reloadButton.disabled) return;

    const targetVersion = pendingVersion.version;
    reloadButton.disabled = true;
    reloadButton.textContent = 'Đang khởi động lại...';

    // Modal chỉ được hiển thị khi hệ thống đã ở trạng thái an toàn. Khi người dùng
    // chủ động bấm Khởi động lại thì phải đi thẳng vào quy trình reload, tuyệt đối
    // không chạy lại nhánh kiểm tra modal khiến chính modal cập nhật tự chặn nó.
    markReloadAttempt(targetVersion);
    await navigateToLatestVersion(targetVersion, 'user-confirmed');
  });

  actions.append(closeButton, reloadButton);
  card.append(icon, title, message, safety, actions);
  overlay.append(card);
  root.replaceChildren(overlay);
}

function scheduleSafePrompt() {
  if (!pendingVersion || updateModalOpen) return;
  if (wasDismissedThisSession(pendingVersion.version)) return;

  if (safeRecheckTimer) {
    window.clearTimeout(safeRecheckTimer);
  }

  safeRecheckTimer = window.setTimeout(() => {
    safeRecheckTimer = null;

    if (!pendingVersion || updateModalOpen) return;
    if (isStudentExamInProgress()) {
      scheduleSafePrompt();
      return;
    }
    if (isUnsafeForVersionPrompt()) {
      scheduleSafePrompt();
      return;
    }
    if (Date.now() - lastUserActivityAt < IDLE_BEFORE_PROMPT_MS) {
      scheduleSafePrompt();
      return;
    }
    showUpdateModal();
  }, SAFE_RECHECK_MS);
}

async function checkForNewVersion({ force = false } = {}) {
  const now = Date.now();
  if (!force && lastVersionCheckAt && now - lastVersionCheckAt < CHECK_INTERVAL_MS) {
    return;
  }
  lastVersionCheckAt = now;

  const latest = await fetchLatestVersion();
  if (!latest || latest.version === CURRENT_BUILD_ID) return;
  setPendingVersion(latest);
}

function installActivityTracking() {
  const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
  activityEvents.forEach((eventName) => {
    window.addEventListener(eventName, () => {
      lastUserActivityAt = Date.now();
    }, { passive: true, capture: true });
  });

  document.addEventListener('input', () => {
    lastEditAt = Date.now();
    lastUserActivityAt = Date.now();
  }, true);

  document.addEventListener('change', () => {
    lastEditAt = Date.now();
    lastUserActivityAt = Date.now();
  }, true);
}

function installCrossTabChannel() {
  if (!('BroadcastChannel' in window)) return;
  try {
    versionChannel = new BroadcastChannel('online-exam-app-version');
    versionChannel.addEventListener('message', (event) => {
      const payload = event.data;
      if (!payload || payload.type !== 'NEW_APP_VERSION') return;
      const versionInfo = payload.versionInfo;
      if (!versionInfo || versionInfo.version === CURRENT_BUILD_ID) return;
      pendingVersion = versionInfo;
      scheduleSafePrompt();
    });
  } catch (_) {}
}

export async function initializeAppVersionGate() {
  window.__APP_BUILD_ID__ = CURRENT_BUILD_ID;

  const latest = await fetchLatestVersion();
  lastVersionCheckAt = Date.now();

  if (!latest || latest.version === CURRENT_BUILD_ID) {
    cleanupReloadQuery();
    return true;
  }

  // Lần khởi động trang: tự cập nhật im lặng trước khi nạp ứng dụng.
  // Chống vòng lặp trong trường hợp CDN đang chuyển phiên bản trong vài giây.
  if (wasReloadJustAttempted(latest.version)) {
    pendingVersion = latest;
    return true;
  }

  markReloadAttempt(latest.version);
  await navigateToLatestVersion(latest.version, 'startup');
  return false;
}

export function startAppVersionMonitoring() {
  installActivityTracking();
  installCrossTabChannel();

  window.addEventListener('focus', () => {
    window.setTimeout(checkForNewVersion, 800);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      window.setTimeout(checkForNewVersion, 800);
      scheduleSafePrompt();
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      window.setTimeout(checkForNewVersion, 800);
    }
  });

  monitorTimer = window.setInterval(checkForNewVersion, CHECK_INTERVAL_MS);

  // API cho các phần khác của ứng dụng đánh dấu vùng tuyệt đối không được reload.
  window.appVersionManager = {
    currentBuildId: CURRENT_BUILD_ID,
    checkNow: () => checkForNewVersion({ force: true }),
    isStudentExamInProgress,
    isUnsafeForVersionPrompt,
    setCriticalActivity(name, active) {
      window.__APP_CRITICAL_ACTIVITY__ = window.__APP_CRITICAL_ACTIVITY__ || {};
      window.__APP_CRITICAL_ACTIVITY__[name] = !!active;
      if (active) {
        closeUpdateModal();
      } else {
        scheduleSafePrompt();
      }
    },
    clearPendingPrompt() {
      closeUpdateModal();
    }
  };

}

export function stopAppVersionMonitoring() {
  if (monitorTimer) window.clearInterval(monitorTimer);
  if (safeRecheckTimer) window.clearTimeout(safeRecheckTimer);
  monitorTimer = null;
  safeRecheckTimer = null;
  try {
    versionChannel?.close();
  } catch (_) {}
  versionChannel = null;
}
