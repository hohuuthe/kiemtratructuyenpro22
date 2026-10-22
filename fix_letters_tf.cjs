const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regex = /function renderTrueFalse\(q, index\) \{[\s\S]*?\}\)\.join\(''\)\}\s*<\/div>\`;\s*\}/;

const newRenderTrueFalse = `function renderTrueFalse(q, index) {
            const currentAnswers = currentExam.answers[index] || {};
            const options = q.shuffledOptions || ['A', 'B', 'C', 'D'];
            return \`<div class="space-y-1.5 w-full">
                \${options.map((opt, i) => {
                    const label = String.fromCharCode(65 + i);
                    const optionData = (q.options && q.options[opt]) ? q.options[opt] : { text: '', image: '' };
                    const selected = currentAnswers[opt];
                    
                    let containerClass = 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30 bg-white';
                    if (selected === true) containerClass = 'selected-true border-emerald-500 bg-emerald-50 shadow-md ring-1 ring-emerald-500';
                    if (selected === false) containerClass = 'selected-false border-rose-500 bg-rose-50 shadow-md ring-1 ring-rose-500';

                    let labelClass = 'text-gray-600 group-hover:text-indigo-600';
                    if (selected === true) labelClass = 'text-emerald-700';
                    if (selected === false) labelClass = 'text-rose-700';

                    return \`
                        <div class="tf-option p-3 md:p-4 border-2 rounded-2xl transition-all duration-200 ease-in-out \${containerClass} w-full flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 group">
                            <div class="flex items-start gap-2 w-full sm:w-auto flex-1 min-w-0">
                                <span class="font-black leading-tight flex-shrink-0 \${labelClass} transition-colors" style="font-size: \${appSettings.answerFontSize || 20}px;">\${label}.</span>
                                <div class="flex-1 min-w-0 pt-0">
                                    <span class="text-gray-700 font-semibold leading-tight break-words responsive-a-text group-hover:text-gray-900 transition-colors block" style="--base-a-size: \${appSettings.answerFontSize || 20}px;">\${formatContent(optionData.text)}</span>
                                    \${optionData.image ? \`<img src="\${optionData.image}" alt="Option \${opt}" class="max-w-full h-16 md:h-20 object-contain rounded-lg cursor-zoom-in hover:scale-105 transition-transform border border-gray-100 shadow-sm bg-white p-1 mt-2" onclick="zoomImage(this.src)">\` : ''}
                                </div>
                            </div>
                            <div class="flex items-center justify-end gap-2 w-full sm:w-auto mt-2 sm:mt-0 flex-shrink-0 border-t sm:border-t-0 border-gray-100 pt-3 sm:pt-0">
                                <button onclick="selectTFAnswer('\${opt}', true, \${index})" class="\${selected === true ? 'bg-emerald-500 text-white shadow-md ring-2 ring-emerald-500 ring-offset-1 scale-105' : 'bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-600'} w-14 h-10 md:w-16 md:h-11 rounded-xl font-bold flex items-center justify-center transition-all duration-200">
                                    Đúng
                                </button>
                                <button onclick="selectTFAnswer('\${opt}', false, \${index})" class="\${selected === false ? 'bg-rose-500 text-white shadow-md ring-2 ring-rose-500 ring-offset-1 scale-105' : 'bg-gray-100 text-gray-500 hover:bg-rose-100 hover:text-rose-600'} w-14 h-10 md:w-16 md:h-11 rounded-xl font-bold flex items-center justify-center transition-all duration-200">
                                    Sai
                                </button>
                            </div>
                        </div>
                    \`;
                }).join('')}
            </div>\`;
        }`;

if (regex.test(content)) {
    content = content.replace(regex, newRenderTrueFalse);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched renderTrueFalse in src/main.js via REGEX successfully!");
} else {
    console.log("Regex did not match renderTrueFalse.");
}
