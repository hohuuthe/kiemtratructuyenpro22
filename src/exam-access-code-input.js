/**
 * Exam access codes are not account passwords. Browsers can offer to save them
 * when the exam challenge uses a native password input, even with autocomplete=off.
 *
 * Chromium/WebKit: use a masked text input (no password-manager password field).
 * Other browsers: fall back to a native password input rather than show the code.
 * The server still validates the supplied code; this helper only changes the UI.
 */
export function configureExamAccessCodeInput(input, css = globalThis.CSS) {
    if (!input) return false;

    let supportsTextMask = false;
    try {
        supportsTextMask = typeof css?.supports === 'function' &&
            css.supports('-webkit-text-security', 'disc');
    } catch {
        supportsTextMask = false;
    }

    if (supportsTextMask) {
        input.type = 'text';
        input.style.setProperty('-webkit-text-security', 'disc');
    } else {
        // Never display a plaintext access code in browsers without CSS masking.
        input.type = 'password';
        input.style.removeProperty('-webkit-text-security');
    }
    return supportsTextMask;
}
