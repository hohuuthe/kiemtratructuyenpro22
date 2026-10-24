/**
 * Unit choices for ranking are presentation-only. Authorization stays in
 * /api/results; teachers never inherit the global user-directory unit list.
 */
export function buildRankingUnitOptions({
    results = [],
    users = [],
    isTeacher = false,
    teacherUnit = '',
    resultsReady = true,
    previousValue = '',
    selectionInitialized = false
} = {}) {
    const units = new Set();
    for (const row of Array.isArray(results) ? results : []) {
        const value = String(row?.donvi || row?.studentClass || '').trim();
        if (value) units.add(value);
    }
    if (isTeacher) {
        // Keep the teacher's own unit when no exam result is available yet.
        // Do not select it before the first server response has finished.
        if (units.size === 0 && resultsReady) {
            const own = String(teacherUnit || '').trim();
            if (own) units.add(own);
        }
    } else {
        for (const user of Array.isArray(users) ? users : []) {
            const value = String(user?.donvi || user?.address || '').trim();
            if (value) units.add(value);
        }
    }
    const ordered = [...units].sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base', numeric: true }));
    // "All units" is the initial selection on every fresh page/session.
    // A teacher's manually chosen school is retained only during the active
    // session; login/logout resets selectionInitialized to false.
    const allOption = { value: '', label: '-- Tất cả đơn vị --' };
    const options = [allOption, ...ordered.map(value => ({ value, label: value }))];
    const previous = String(previousValue || '');
    const selectedValue = isTeacher
        ? (selectionInitialized && ordered.includes(previous) ? previous : '')
        : (ordered.includes(previous) ? previous : '');
    return { options, selectedValue };
}
