const q = {
    shuffledOptions: ['A', 'B', 'C', 'D'],
    options: {
        A: { text: 'Short A' },
        B: { text: 'Short B' },
        C: { text: 'Short C' },
        D: { text: 'Short D' },
    }
};

let hasImage = false;
let maxLen = 0;
for (const opt of q.shuffledOptions) {
    const o = q.options[opt];
    if (o) {
        if (o.image) hasImage = true;
        const textLen = (o.text || '').replace(/<[^>]*>?/gm, '').length;
        if (textLen > maxLen) maxLen = textLen;
    }
}

let gridClass = 'grid-cols-1';
if (!hasImage) {
    if (maxLen < 20) {
        gridClass = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
    } else if (maxLen < 60) {
        gridClass = 'grid-cols-1 sm:grid-cols-2';
    }
}
console.log(gridClass);
