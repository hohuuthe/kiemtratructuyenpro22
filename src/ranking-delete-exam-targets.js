/**
 * Turn the ranking tab's legacy NAME filter into a list of exact exam IDs.
 * Names are not unique: do not delete by name or by the currently displayed
 * (school/class-filtered) student results. Only persisted exam configs qualify.
 *
 * This is a presentation helper, NOT an authorization boundary. The server
 * independently verifies each current account and the chosen exam's creator.
 */
export function resolveRankingDeleteExamTargets(selectedName, configs, currentUser, isAdmin) {
    if (typeof selectedName !== 'string' || !selectedName.trim() ||
        !Array.isArray(configs) || !currentUser?.id) return [];

    const validId = value =>
        typeof value === 'string' && value.trim().length > 0 &&
        value.length <= 256 && !value.includes('\0');
    const ownerIds = new Set([currentUser.id, currentUser.user_id]
        .filter(value => value != null && String(value).trim())
        .map(value => String(value).trim()));
    const byId = new Map();

    for (const config of configs) {
        if (!config || config.name !== selectedName || !validId(config.id)) continue;
        const creatorId = config.creator_id ?? config.creatorId;
        if (!isAdmin && (!creatorId || !ownerIds.has(String(creatorId).trim()))) continue;
        if (!byId.has(config.id)) {
            byId.set(config.id, {
                id: config.id,
                name: String(config.name),
                creatorId: creatorId == null ? '' : String(creatorId)
            });
        }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'vi'));
}
