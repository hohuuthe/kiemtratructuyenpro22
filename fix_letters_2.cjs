const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regex = /function renderMultipleChoice\(q, index\) \{[\s\S]*?\}\)\.join\(''\)\}\s*<\/div>\`;\s*\}/;

const newRenderMultipleChoice = `function renderMultipleChoice(q, index) {
            const options = q.shuffledOptions || ['A', 'B', 'C', 'D'];
            const selectedAnswer = currentExam.answers[index];
            return \`<div class="grid grid-cols-1 gap-1.5 w-full">
                \${options.map((opt, i) => {
                    const label = String.fromCharCode(65 + i);
                    const optionData = (q.options && q.options[opt]) ? q.options[opt] : { text: '', image: '' };
                    const isSelected = selectedAnswer === opt;
                    
                    let optionClass = isSelected 
                        ? 'selected border-indigo-500 bg-indigo-50 shadow-md ring-1 ring-indigo-500' 
                        : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 hover:shadow-sm bg-white';
                    
                    let labelClass = isSelected
                        ? 'text-indigo-600'
                        : 'text-gray-700 group-hover:text-indigo-600';

                    return \`
                        <div onclick="selectAnswer('\${opt}', \${index})" class="group question-option px-4 py-3 border-2 rounded-2xl cursor-pointer transition-all duration-200 ease-in-out \${optionClass} flex items-start gap-2 min-h-[3rem]">
                            <div class="text-left flex-1 min-w-0 flex">
                                <span class="font-black leading-tight flex-shrink-0 mr-2 \${labelClass} transition-colors" style="font-size: \${appSettings.answerFontSize || 20}px;">\${label}.</span>
                                <div class="text-gray-700 font-semibold leading-tight break-words responsive-a-text group-hover:text-gray-900 transition-colors flex-1" style="--base-a-size: \${appSettings.answerFontSize || 20}px;">
                                    \${formatContent(optionData.text)}
                                    \${optionData.image ? \`<div class="mt-2"><img src="\${optionData.image}" alt="Option \${opt}" class="max-w-full h-20 object-contain rounded-lg cursor-zoom-in hover:scale-105 transition-transform border border-gray-100 shadow-sm bg-white p-1" onclick="event.stopPropagation(); zoomImage(this.src)"></div>\` : ''}
                                </div>
                            </div>
                            \${isSelected ? \`<div class="flex-shrink-0 text-indigo-500 self-center ml-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg></div>\` : ''}
                        </div>
                    \`;
                }).join('')}
            </div>\`;
        }`;

if (regex.test(content)) {
    content = content.replace(regex, newRenderMultipleChoice);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched renderMultipleChoice in src/main.js via REGEX successfully!");
} else {
    console.log("Regex did not match.");
}
