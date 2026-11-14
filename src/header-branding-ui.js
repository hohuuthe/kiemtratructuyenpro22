import { DEFAULT_HEADER_TITLE, headerMode, normalizedHeaderBranding } from './header-branding-policy.js';

const find = id => document.getElementById(id);
const label = text => String(text || '').trim();
let temporaryPreview = '';
const fileInput = () => find('settings-header-banner-file');
const toast = (message, kind = 'info') => {
  if (typeof window.showToast === 'function') window.showToast(message, kind);
};

function selectedBranding(settings) {
  return normalizedHeaderBranding({
    header_display_mode: settings?.headerDisplayMode ?? settings?.header_display_mode,
    header_banner_url: settings?.headerBannerUrl ?? settings?.header_banner_url,
    header_banner_key: settings?.headerBannerKey ?? settings?.header_banner_key,
    header_banner_alt: settings?.headerBannerAlt ?? settings?.header_banner_alt
  });
}

export function applyHeaderBranding(settings) {
  const title = find('app-title');
  const banner = find('app-header-banner');
  const image = find('app-header-banner-img');
  if (!title || !banner || !image) return;
  const content = label(settings?.appTitle ?? settings?.app_title) || DEFAULT_HEADER_TITLE;
  title.textContent = content;
  const branding = selectedBranding(settings);
  const showBanner = branding.mode !== 'text' && !!branding.url;
  const showTitle = branding.mode !== 'banner';
  title.classList.toggle('sr-only', !showTitle && showBanner);
  if (!showBanner) {
    banner.hidden = true;
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
    return;
  }
  banner.hidden = false;
  image.alt = branding.alt || content;
  const loadedUrl = image.getAttribute('src');
  if (loadedUrl === branding.url && image.complete && image.naturalWidth > 0) return;
  // A failed image must never replace all identification for the application.
  title.classList.remove('sr-only');
  image.onload = () => {
    if (image.getAttribute('src') === branding.url) {
      title.classList.toggle('sr-only', !showTitle);
      banner.hidden = false;
    }
  };
  image.onerror = () => {
    if (image.getAttribute('src') === branding.url) {
      banner.hidden = true;
      title.classList.remove('sr-only');
    }
  };
  image.src = branding.url;
}

export function populateBrandingSettings(settings) {
  const mode = find('settings-header-mode');
  if (!mode) return;
  const current = selectedBranding(settings);
  mode.value = current.mode;
  const key = find('settings-banner-key');
  const url = find('settings-banner-url');
  const alt = find('settings-banner-alt');
  if (key) key.value = current.key;
  if (url) url.value = current.url;
  if (alt) alt.value = current.alt;
  if (fileInput()) fileInput().value = '';
  revokePreview();
  renderBrandingPreview();
}

function revokePreview() {
  if (temporaryPreview) URL.revokeObjectURL(temporaryPreview);
  temporaryPreview = '';
}

export function previewHeaderBrandingSettings() {
  const file = fileInput()?.files?.[0];
  revokePreview();
  if (file) temporaryPreview = URL.createObjectURL(file);
  renderBrandingPreview();
}

export function clearHeaderBrandingBanner() {
  const mode = find('settings-header-mode');
  const key = find('settings-banner-key');
  const url = find('settings-banner-url');
  if (key) key.value = '';
  if (url) url.value = '';
  if (fileInput()) fileInput().value = '';
  revokePreview();
  if (mode && mode.value !== 'text') mode.value = 'text';
  renderBrandingPreview();
  toast('Đã bỏ ảnh khỏi cấu hình nháp. Bấm Lưu và áp dụng để xác nhận.', 'info');
}

function renderBrandingPreview() {
  const modeEl = find('settings-header-mode');
  const title = find('settings-app-title');
  const img = find('settings-header-preview-img');
  const empty = find('settings-header-preview-empty');
  const heading = find('settings-header-preview-title');
  const filename = find('settings-header-file-name');
  if (!modeEl || !img || !empty || !heading) return;
  const mode = headerMode(modeEl.value);
  heading.textContent = label(title?.value) || DEFAULT_HEADER_TITLE;
  heading.hidden = mode === 'banner';
  const imageUrl = temporaryPreview || find('settings-banner-url')?.value || '';
  const displayImage = mode !== 'text' && !!imageUrl;
  img.hidden = !displayImage;
  empty.hidden = displayImage;
  if (displayImage) {
    img.onerror = () => {
      img.hidden = true;
      empty.hidden = false;
      heading.hidden = false;
      empty.textContent = 'Không đọc được banner. Vui lòng chọn ảnh khác.';
    };
    img.src = imageUrl;
  } else img.removeAttribute('src');
  if (filename) filename.textContent = fileInput()?.files?.[0]?.name ||
    (find('settings-banner-url')?.value ? 'Đã lưu banner trên hệ thống' : 'Chưa có banner');
}

const authToken = () => {
  if (typeof window.tenantStorageKey !== 'function') return '';
  return localStorage.getItem(window.tenantStorageKey('auth_token')) || '';
};

async function requestJson(method, body) {
  const token = authToken();
  if (!token) throw new Error('Vui lòng đăng nhập Admin trước khi thay đổi banner.');
  const response = await fetch('/api/header-banner', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
    cache: 'no-store'
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('Máy chủ không trả về dữ liệu cấu hình hợp lệ.'); }
  if (!response.ok || payload.error) throw new Error(payload.error || 'Không thể lưu cấu hình.');
  return payload.data;
}

async function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('Không thể đọc tệp banner.'));
    reader.readAsDataURL(file);
  });
}

export async function saveHeaderBrandingSettings(settings, refreshHeader) {
  const saveButton = find('settings-header-save');
  if (!saveButton || saveButton.disabled || !find('settings-header-mode')) return;
  const draft = {
    app_title: label(find('settings-app-title')?.value),
    header_display_mode: headerMode(find('settings-header-mode').value),
    header_banner_key: find('settings-banner-key')?.value || '',
    header_banner_url: find('settings-banner-url')?.value || '',
    header_banner_alt: label(find('settings-banner-alt')?.value)
  };
  if (!draft.app_title || draft.app_title.length > 180) {
    toast('Tiêu đề phải có từ 1 đến 180 ký tự.', 'error');
    return;
  }
  if (draft.header_banner_alt.length > 120) {
    toast('Mô tả banner tối đa 120 ký tự.', 'error');
    return;
  }
  const file = fileInput()?.files?.[0];
  if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size < 1 || file.size > 5 * 1024 * 1024)) {
    toast('Chọn ảnh PNG, JPG hoặc WebP, dung lượng tối đa 5 MB.', 'error');
    return;
  }
  if (draft.header_display_mode !== 'text' && !file && !draft.header_banner_url) {
    toast('Vui lòng tải ảnh banner trước khi chọn chế độ có hình.', 'error');
    return;
  }
  saveButton.disabled = true;
  const originalText = saveButton.textContent;
  saveButton.textContent = 'Đang lưu cấu hình...';
  try {
    if (file) {
      const base64 = await readImageAsDataUrl(file);
      const upload = await requestJson('POST', { base64 });
      draft.header_banner_key = upload.key;
      draft.header_banner_url = upload.url;
    }
    // The active banner is changed only after server-side DB save succeeds.
    const committed = await requestJson('PUT', draft);
    Object.assign(settings, {
      appTitle: committed.app_title,
      headerDisplayMode: committed.header_display_mode,
      headerBannerUrl: committed.header_banner_url,
      headerBannerKey: committed.header_banner_key,
      headerBannerAlt: committed.header_banner_alt
    });
    window.appSettings = settings;
    populateBrandingSettings(settings);
    refreshHeader?.();
    toast('Đã lưu và áp dụng thương hiệu hệ thống thành công.', 'success');
  } catch (error) {
    toast(error?.message || 'Không thể lưu banner. Cấu hình đang dùng chưa thay đổi.', 'error');
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalText;
  }
}
