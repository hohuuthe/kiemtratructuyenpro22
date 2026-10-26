/**
 * Unified modal policy for the KTTT application.
 *
 * A form must not be dismissed by its backdrop, Escape or a click behind it.
 * Only explicit buttons/actions inside the current dialog can close it.
 * The guard works with legacy inline handlers, dynamically generated dialogs,
 * and dialogs mounted inside asynchronously loaded tab components.
 */
const MODAL_ROOTS = [
  '[id*="modal"]',
  '[role="dialog"][aria-modal="true"]',
  'dialog[open]',
  '#pwa-modal-root > .fixed',
  '#qr-modal-backdrop',
  '#mobile-actions-backdrop'
].join(',');

const BACKDROP_SELECTORS = '.modal-overlay,[data-modal-backdrop],#zoom-overlay-bg';
const FOCUSABLE = [
  'button:not([disabled]):not(.hidden)',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

/** Pure predicate, exported so the global behavior has regression tests. */
export function isModalBackdropTarget(target, modal) {
  if (!target || !modal) return false;
  if (target === modal) return true;
  const backdrop = typeof target.closest === 'function'
    ? target.closest(BACKDROP_SELECTORS) : null;
  return !!(backdrop && typeof modal.contains === 'function' && modal.contains(backdrop));
}

export function isModalSurface(element) {
  if (!element || !element.classList) return false;
  if (!element.classList.contains('fixed') && element.tagName !== 'DIALOG') return false;
  return element.tagName === 'DIALOG' ||
    element.classList.contains('inset-0') ||
    element.id === 'modal-container' || element.id === 'secondary-modal-container';
}

function isDisplayed(element) {
  if (!isModalSurface(element) || !element.isConnected || element.hidden ||
      element.classList.contains('hidden') || element.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' &&
    Number(style.opacity) !== 0 && element.getClientRects().length > 0;
}

export function findActiveModal(doc = document) {
  let top = null;
  let highest = -Infinity;
  for (const element of doc.querySelectorAll(MODAL_ROOTS)) {
    if (!isDisplayed(element)) continue;
    const z = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
    const priority = Number.isFinite(z) ? z : 0;
    // The later node is painted on top when z-index ties.
    if (priority >= highest) { top = element; highest = priority; }
  }
  return top;
}

function focusInside(modal) {
  if (!modal) return;
  const active = document.activeElement;
  if (active && modal.contains(active)) return;
  let item = modal.querySelector('[autofocus]') || modal.querySelector(FOCUSABLE);
  if (!item) {
    if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    item = modal;
  }
  try { item.focus({ preventScroll: true }); } catch { item.focus?.(); }
}

let installed = false;
export function installModalBehavior() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  let lastTop = null;
  let refreshQueued = false;
  const sync = () => {
    refreshQueued = false;
    const next = findActiveModal();
    const locked = !!next;
    document.documentElement.classList.toggle('kttt-modal-open', locked);
    document.body.classList.toggle('kttt-modal-open', locked);
    if (next && next !== lastTop) {
      if (next.getAttribute('aria-modal') !== 'true') next.setAttribute('aria-modal','true');
      focusInside(next);
    }
    lastTop = next;
  };
  const scheduleSync = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(sync);
  };

  const blockOutside = event => {
    const top = findActiveModal();
    if (!top) return;
    const target = event.target;
    if (!top.contains(target) || isModalBackdropTarget(target, top)) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  for (const type of ['pointerdown','mousedown','pointerup','mouseup','click','dblclick','contextmenu','touchstart','touchend']) {
    window.addEventListener(type, blockOutside, { capture: true, passive: false });
  }
  for (const type of ['wheel','touchmove']) {
    window.addEventListener(type, blockOutside, { capture: true, passive: false });
  }
  const blockEscape = event => {
    const top = findActiveModal();
    if (!top) return;
    if (event.key === 'Escape' || event.key === 'Esc') {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.type !== 'keydown' || event.key !== 'Tab') return;
    const items = [...top.querySelectorAll(FOCUSABLE)].filter(item =>
      !item.hidden && item.getClientRects().length && window.getComputedStyle(item).visibility !== 'hidden'
    );
    if (!items.length) {
      if (event.cancelable) event.preventDefault();
      focusInside(top);
      return;
    }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (!top.contains(active) || (event.shiftKey && active === first)) {
      if (event.cancelable) event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && active === last) {
      if (event.cancelable) event.preventDefault();
      first.focus();
    }
  };
  window.addEventListener('keydown', blockEscape, true);
  window.addEventListener('keyup', blockEscape, true);

  let correctingFocus = false;
  document.addEventListener('focusin', event => {
    const top = findActiveModal();
    if (!top || top.contains(event.target) || correctingFocus) return;
    correctingFocus = true;
    focusInside(top);
    correctingFocus = false;
  }, true);

  const matchesModal = element => element?.nodeType === 1 && (
    element.matches?.(MODAL_ROOTS) || element.querySelector?.(MODAL_ROOTS)
  );
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => {
      if (m.type === 'attributes') return m.target?.matches?.(MODAL_ROOTS);
      if (matchesModal(m.target)) return true;
      return [...m.addedNodes, ...m.removedNodes].some(matchesModal);
    })) scheduleSync();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class','style','hidden','open','aria-hidden']
  });
  sync();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installModalBehavior, { once: true });
  } else {
    installModalBehavior();
  }
}
