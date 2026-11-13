/**
 * Copy toast text with the synchronous user-gesture fallback first.
 * Clipboard.writeText can be unavailable/rejected in embedded browsers and
 * calling it before execCommand can lose transient user activation.
 */
export async function copyToastMessage(message, { doc = globalThis.document, clipboard = globalThis.navigator?.clipboard } = {}) {
    const text = String(message ?? '');
    if (!text || !doc?.createElement) return false;
    const activeElement = doc.activeElement;
    let copied = false;
    let textarea;
    try {
        textarea = doc.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        textarea.style.opacity = '0';
        (doc.body || doc.documentElement).appendChild(textarea);
        textarea.focus();
        textarea.select();
        // Selecting the textarea already covers the whole value. A blocked
        // setSelectionRange() must not prevent the synchronous copy attempt.
        copied = doc.execCommand?.('copy') === true;
    } catch {
        // Try the modern Clipboard API below instead.
    } finally {
        textarea?.remove();
        try { activeElement?.focus?.({ preventScroll: true }); } catch {}
    }
    if (copied) return true;
    try {
        if (typeof clipboard?.writeText === 'function') {
            await clipboard.writeText(text);
            return true;
        }
    } catch {
        // Caller displays the failure; never claim the copy succeeded.
    }
    return false;
}
