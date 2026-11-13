// Bank counts and visible/selected questions must use the same exact level semantics.
export function matchesQuestionBankLevel(question, level = 'ALL') {
    return level === 'ALL' || question?.level === level;
}

export function countQuestionBankLevels(items) {
    const counts = { NB: 0, TH: 0, VD: 0 };
    for (const question of items) {
        const level = question?.level;
        if (level === 'NB' || level === 'TH' || level === 'VD') counts[level] += 1;
    }
    return counts;
}
