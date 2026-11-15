/** Student identity header, rendered only within the actual fullscreen exam root.
 * Presentation only: never modify fullscreen state, exam timing or question DOM.
 */
import { DEFAULT_HEADER_TITLE, headerMode, normalizedHeaderBranding, bannerShownForMode } from './header-branding-policy.js';

export function studentExamHeaderState(settings, ownerMode = 'school') {
  const mode = headerMode(settings?.examHeaderDisplayMode ?? settings?.exam_header_display_mode);
  const brand = normalizedHeaderBranding({
    header_display_mode: 'both',
    header_banner_scope: settings?.headerBannerScope ?? settings?.header_banner_scope,
    header_banner_url: settings?.headerBannerUrl ?? settings?.header_banner_url,
    header_banner_tablet_url: settings?.headerBannerTabletUrl ?? settings?.header_banner_tablet_url,
    header_banner_mobile_url: settings?.headerBannerMobileUrl ?? settings?.header_banner_mobile_url,
    header_banner_alt: settings?.headerBannerAlt ?? settings?.header_banner_alt
  });
  const hasBanner = mode !== 'text' && Boolean(brand.url) &&
    bannerShownForMode(brand.scope, ownerMode);
  return {
    mode, title: String(settings?.appTitle ?? settings?.app_title ?? '').trim() || DEFAULT_HEADER_TITLE,
    brand, hasBanner, showTitle: mode !== 'banner' || !hasBanner
  };
}

function preferredUrl(brand) {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(max-width: 600px)').matches && brand.mobileUrl) return brand.mobileUrl;
    if (window.matchMedia('(min-width: 601px) and (max-width: 1024px)').matches && brand.tabletUrl) return brand.tabletUrl;
  }
  return brand.url;
}

let lastSettings = null;
let listenersBound = false;
export function applyStudentExamHeaderBranding(settings) {
  lastSettings = settings;
  if (typeof document === 'undefined') return;
  const root = document.getElementById('exam-interface');
  const container = document.getElementById('exam-header-branding');
  const title = document.getElementById('exam-header-branding-title');
  const image = document.getElementById('exam-header-branding-img');
  if (!root || !container || !title || !image) return;
  if (!listenersBound && typeof window !== 'undefined') {
    listenersBound = true;
    window.addEventListener('resize', () => {
      if (lastSettings) applyStudentExamHeaderBranding(lastSettings);
    }, { passive: true });
  }
  const isFullscreen = document.fullscreenElement === root;
  if (!isFullscreen || root.classList.contains('hidden')) {
    container.hidden = true;
    return;
  }
  // Read the verified exam owner, not the default landing-tab preference.
  const ownerMode = window.__activeStudentExamTab === 'contest' ? 'contest' : 'school';
  const { title: heading, brand, hasBanner, showTitle } = studentExamHeaderState(settings, ownerMode);
  container.hidden = false;
  title.textContent = heading;
  title.hidden = !showTitle;
  if (!hasBanner) {
    image.hidden = true;
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
    return;
  }
  const wanted = preferredUrl(brand);
  image.alt = showTitle ? '' : (brand.alt || heading);
  // Always keep text identity during loading; if image fails, preserve the title.
  title.hidden = false;
  image.hidden = true;
  image.onload = () => {
    if (document.fullscreenElement !== root || root.classList.contains('hidden')) return;
    if (image.getAttribute('src') === wanted || image.getAttribute('src') === brand.url) {
      image.hidden = false;
      title.hidden = !showTitle;
    }
  };
  image.onerror = () => {
    if (image.getAttribute('src') === wanted && wanted !== brand.url) {
      image.src = brand.url;
      return;
    }
    image.hidden = true;
    title.hidden = false;
  };
  if (image.getAttribute('src') !== wanted) image.src = wanted;
  else if (image.complete && image.naturalWidth > 0) {
    image.hidden = false;
    title.hidden = !showTitle;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    if (lastSettings) applyStudentExamHeaderBranding(lastSettings);
    else if (typeof window !== 'undefined' && window.appSettings)
      applyStudentExamHeaderBranding(window.appSettings);
  });
}
