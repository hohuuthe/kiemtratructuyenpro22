import { DEFAULT_HEADER_TITLE, headerMode, normalizedHeaderBranding } from './header-branding-policy.js';

const find = id => document.getElementById(id);
const label = text => String(text || '').trim();
let temporaryPreview = '';
const fileInput = (device = 'desktop') => find(device === 'desktop' ? 'settings-header-banner-file' : 'settings-header-banner-' + device + '-file');
const devices = ['desktop','tablet','mobile'];
const field = (device,type) => device === 'desktop' ? 'settings-banner-'+type : 'settings-banner-'+device+'-'+type;
let previewDevice = 'desktop';
let renderedSettings = null;
let imageQueriesBound = false;
export function selectHeaderBannerPreview(device) {
  if (!devices.includes(device)) return;
  previewDevice = device;
  for (const name of devices) find('settings-banner-preview-'+name)?.setAttribute('aria-pressed',String(name===device));
  renderBrandingPreview();
}
function preferredBannerUrl(branding) {
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(max-width: 600px)').matches && branding.mobileUrl) return branding.mobileUrl;
    if (window.matchMedia('(min-width: 601px) and (max-width: 1024px)').matches && branding.tabletUrl) return branding.tabletUrl;
  }
  return branding.url;
}
function ensureImageQueryListeners() {
  if (imageQueriesBound || typeof window.matchMedia !== 'function') return;
  imageQueriesBound = true;
  for (const query of ['(max-width: 600px)','(min-width: 601px) and (max-width: 1024px)']) {
    window.matchMedia(query).addEventListener?.('change',()=>{ if(renderedSettings) applyHeaderBranding(renderedSettings); });
  }
}
const toast = (message, kind = 'info') => {
  if (typeof window.showToast === 'function') window.showToast(message, kind);
};

function selectedBranding(settings) {
  return normalizedHeaderBranding({
    header_display_mode: settings?.headerDisplayMode ?? settings?.header_display_mode,
    header_banner_url: settings?.headerBannerUrl ?? settings?.header_banner_url,
    header_banner_key: settings?.headerBannerKey ?? settings?.header_banner_key,
    header_banner_tablet_url: settings?.headerBannerTabletUrl ?? settings?.header_banner_tablet_url,
    header_banner_tablet_key: settings?.headerBannerTabletKey ?? settings?.header_banner_tablet_key,
    header_banner_mobile_url: settings?.headerBannerMobileUrl ?? settings?.header_banner_mobile_url,
    header_banner_mobile_key: settings?.headerBannerMobileKey ?? settings?.header_banner_mobile_key,
    header_banner_alt: settings?.headerBannerAlt ?? settings?.header_banner_alt
  });
}

export function applyHeaderBranding(settings) {
  renderedSettings = settings;
  ensureImageQueryListeners();
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
  const targetUrl = preferredBannerUrl(branding);
  const loadedUrl = image.getAttribute('src');
  if (loadedUrl === targetUrl && image.complete && image.naturalWidth > 0) return;
  // A failed image must never replace all identification for the application.
  title.classList.remove('sr-only');
  image.onload = () => {
    if (image.getAttribute('src') === targetUrl || image.getAttribute('src') === branding.url) {
      title.classList.toggle('sr-only', !showTitle);
      banner.hidden = false;
    }
  };
  image.onerror = () => {
    if (image.getAttribute('src') === targetUrl && targetUrl !== branding.url) {
      image.src = branding.url; // Fallback to the full-width banner.
      return;
    }
    if (image.getAttribute('src') === branding.url) {
      banner.hidden = true;
      title.classList.remove('sr-only');
    }
  };
  image.src = targetUrl;
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
  for (const device of devices) {
    if (device !== 'desktop') {
      const id = field(device,'key'), link = field(device,'url');
      if (find(id)) find(id).value = device === 'tablet' ? current.tabletKey : current.mobileKey;
      if (find(link)) find(link).value = device === 'tablet' ? current.tabletUrl : current.mobileUrl;
    }
    if (fileInput(device)) fileInput(device).value = '';
  }
  revokePreview();
  renderBrandingPreview();
}

const temporaryPreviews = new Map();
function revokePreview() {
  for (const url of temporaryPreviews.values()) URL.revokeObjectURL(url);
  temporaryPreviews.clear();
}
export function previewHeaderBrandingSettings() {
  revokePreview();
  for (const device of devices) {
    const file = fileInput(device)?.files?.[0];
    if (file) temporaryPreviews.set(device, URL.createObjectURL(file));
  }
  renderBrandingPreview();
}
export function clearHeaderBrandingVariant(device) {
  if (!devices.includes(device)) return;
  const clear = name => {
    for (const property of ['key','url']) {
      const element = find(field(name,property));
      if (element) element.value = '';
    }
    if (fileInput(name)) fileInput(name).value = '';
  };
  clear(device);
  if (device === 'desktop') {
    clear('tablet'); clear('mobile');
    const mode = find('settings-header-mode');
    if (mode && mode.value !== 'text') mode.value = 'text';
  }
  previewHeaderBrandingSettings();
  toast(device === 'desktop' ? 'Đã bỏ các banner khỏi cấu hình nháp. Bấm Lưu và áp dụng để xác nhận.'
    : 'Đã bỏ ảnh riêng; thiết bị sẽ dùng banner máy tính khi lưu.', 'info');
}
export function clearHeaderBrandingBanner() { clearHeaderBrandingVariant('desktop'); }
function renderBrandingPreview() {
  const modeEl = find('settings-header-mode'), title = find('settings-app-title');
  const img = find('settings-header-preview-img');
  const empty = find('settings-header-preview-empty'), heading = find('settings-header-preview-title');
  if (!modeEl || !img || !empty || !heading) return;
  const mode = headerMode(modeEl.value);
  heading.textContent = label(title?.value) || DEFAULT_HEADER_TITLE;
  heading.hidden = mode === 'banner';
  const desktopUrl = temporaryPreviews.get('desktop') || find(field('desktop','url'))?.value || '';
  const specificUrl = temporaryPreviews.get(previewDevice) || find(field(previewDevice,'url'))?.value || '';
  const imageUrl = specificUrl || desktopUrl;
  const showImage = mode !== 'text' && !!imageUrl;
  const viewport = find('settings-header-preview-viewport');
  if (viewport) viewport.dataset.device = previewDevice;
  img.hidden = !showImage; empty.hidden = showImage;
  if (showImage) {
    img.onload = () => {
      if (img.getAttribute('src') !== imageUrl) return;
      const meta = find('settings-banner-preview-dimensions');
      if(meta) meta.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px' +
        (!specificUrl && previewDevice !== 'desktop' ? ' • Dùng banner máy tính dự phòng' : '');
    };
    img.onerror = () => {
      img.hidden = true; empty.hidden = false; heading.hidden = false;
      empty.textContent = 'Không thể đọc banner. Vui lòng chọn ảnh khác.';
    };
    img.src = imageUrl;
  } else {
    img.removeAttribute('src');
    const meta = find('settings-banner-preview-dimensions');
    if(meta) meta.textContent = 'Chưa có ảnh';
    empty.textContent = mode === 'text' ? 'Chế độ chỉ tiêu đề chữ' : 'Chưa chọn banner';
  }
  for(const device of devices) {
    const caption = find(device === 'desktop' ? 'settings-header-file-name' : 'settings-'+device+'-file-name');
    if (caption) caption.textContent = fileInput(device)?.files?.[0]?.name ||
      (find(field(device,'url'))?.value ? 'Đã lưu trên hệ thống' :
        device === 'desktop' ? 'Chưa có banner' : 'Không bắt buộc • Sử dụng banner máy tính');
  }
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
    header_banner_tablet_key: find('settings-banner-tablet-key')?.value || '',
    header_banner_tablet_url: find('settings-banner-tablet-url')?.value || '',
    header_banner_mobile_key: find('settings-banner-mobile-key')?.value || '',
    header_banner_mobile_url: find('settings-banner-mobile-url')?.value || '',
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
  const files = Object.fromEntries(devices.map(device => [device,fileInput(device)?.files?.[0]]));
  for (const [device, file] of Object.entries(files)) {
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size < 1 || file.size > 5 * 1024 * 1024)) {
      toast('Ảnh ' + device + ': chỉ chọn PNG, JPG hoặc WebP, tối đa 5 MB.', 'error');
      return;
    }
  }
  if (draft.header_display_mode !== 'text' && !files.desktop && !draft.header_banner_url) {
    toast('Vui lòng tải ảnh banner trước khi chọn chế độ có hình.', 'error');
    return;
  }
  saveButton.disabled = true;
  const originalText = saveButton.textContent;
  saveButton.textContent = 'Đang lưu cấu hình...';
  try {
    for (const device of devices) {
      const file = files[device];
      if (!file) continue;
      const base64 = await readImageAsDataUrl(file);
      const upload = await requestJson('POST', { base64 });
      const prefix = device === 'desktop' ? 'header_banner_' : 'header_banner_' + device + '_';
      draft[prefix + 'key'] = upload.key;
      draft[prefix + 'url'] = upload.url;
    }
    // The active banner is changed only after server-side DB save succeeds.
    const committed = await requestJson('PUT', draft);
    Object.assign(settings, {
      appTitle: committed.app_title,
      headerDisplayMode: committed.header_display_mode,
      headerBannerUrl: committed.header_banner_url,
      headerBannerKey: committed.header_banner_key,
      headerBannerTabletUrl: committed.header_banner_tablet_url,
      headerBannerTabletKey: committed.header_banner_tablet_key,
      headerBannerMobileUrl: committed.header_banner_mobile_url,
      headerBannerMobileKey: committed.header_banner_mobile_key,
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
