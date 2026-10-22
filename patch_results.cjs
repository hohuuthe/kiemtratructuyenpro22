const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Refactor renderTypeRow
const renderTypeRowRegex = /const renderTypeRow = [\s\S]*?};/m;
const newRenderTypeRow = `const renderTypeRow = (type, label, color) => {
                const s = stats[type] || { total: 0, answered: 0, correct: 0 };
                if (s.total === 0) return '';
                return \`
                    <div class="flex items-center justify-between p-2 md:p-3 bg-white rounded-xl border border-gray-200 shadow-sm transition-all hover:border-emerald-300">
                        <div class="flex items-center gap-2 md:gap-3">
                            <div class="flex-shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-full \${color} flex items-center justify-center text-white font-bold text-[10px] md:text-[12px] uppercase shadow-md">
                                \${type}
                            </div>
                            <div class="min-w-0">
                                <p class="font-bold text-gray-800 text-[11px] md:text-sm whitespace-normal leading-tight" title="\${label}">\${label}</p>
                                <p class="text-[10px] md:text-xs text-gray-500 mt-0.5">SL: <b>\${s.total}</b></p>
                            </div>
                        </div>
                        <div class="text-right flex-shrink-0 pl-2">
                            <p class="text-[11px] md:text-sm font-semibold text-gray-600">Đúng: <span class="text-green-600 font-black">\${s.correct}</span>/\${s.total}</p>
                            <p class="text-[9px] md:text-[11px] text-gray-400 italic">Đã làm: \${s.answered}/\${s.total}</p>
                            \${type === 'TF4' ? \`<p class="text-[9px] md:text-[11px] text-purple-600 font-bold mt-0.5">Số ý đúng: \${s.correctStatements}/\${s.totalStatements}</p>\` : ''}
                        </div>
                    </div>
                \`;
            };`;
content = content.replace(renderTypeRowRegex, newRenderTypeRow);

// Refactor statsDetailedHtml
content = content.replace(
    /<div class="grid grid-cols-2 lg:grid-cols-4 gap-1.5">/g,
    '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">'
);

// Refactor grid of top stats (score, correct, time)
content = content.replace(
    /<div class="grid grid-cols-3 gap-1.5 md:gap-2 mb-2">/g,
    '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3 mb-4">'
);
content = content.replace(
    /text-2xl md:text-3xl font-black/g,
    'text-3xl md:text-4xl font-black'
);
content = content.replace(
    /text-\[9px\] md:text-\[10px\]/g,
    'text-xs md:text-sm'
);
content = content.replace(
    /text-\[8px\] md:text-\[10px\]/g,
    'text-xs md:text-sm'
);
content = content.replace(
    /text-\[8px\] md:text-\[9px\]/g,
    'text-[10px] md:text-xs'
);
content = content.replace(
    /py-0\.5 px-1\.5/g,
    'py-1 px-2.5'
);
content = content.replace(
    /<div class="p-1.5 bg-blue/g,
    '<div class="p-3 bg-blue'
);
content = content.replace(
    /<div class="p-1.5 bg-green/g,
    '<div class="p-3 bg-green'
);
content = content.replace(
    /<div class="p-1.5 bg-purple/g,
    '<div class="p-3 bg-purple'
);

// Details layout fixes
content = content.replace(
    /max-h-\[250px\] overflow-y-auto pr-1 custom-scrollbar/g,
    'max-h-[500px] overflow-y-auto pr-2 custom-scrollbar space-y-3'
);
content = content.replace(
    /mb-3 overflow-hidden/g,
    'mb-0 overflow-hidden shadow-sm'
);

// General answer display texts
content = content.replace(
    /<p class="text-base break-words">/g,
    '<p class="text-sm md:text-base break-words mt-1">'
);

fs.writeFileSync('src/main.js', content);
console.log("Results layout patched.");
