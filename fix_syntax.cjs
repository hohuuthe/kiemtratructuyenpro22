const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const brokenRegex = /const renderTypeRow = \(type, label, color\) => \{[\s\S]*?<\/div>\s*`\s*;\s*\}\s*;/m;
// Let's just find the start of statsDetailedHtml and remove everything between renderTypeRow and statsDetailedHtml.

content = content.replace(/const renderTypeRow = \(type, label, color\) => \{[\s\S]*?const statsDetailedHtml =/m, 
`const renderTypeRow = (type, label, color) => {
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
            };
            const statsDetailedHtml =`);

fs.writeFileSync('src/main.js', content);
console.log("Syntax fixed.");
