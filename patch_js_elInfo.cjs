const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldCode = `                    if (!isEnough) {
                        statusHtml = \`<span class="text-sm text-red-300 font-bold mt-1 drop-shadow-sm flex items-center gap-1" title="\${countDetails}">❌ Kho không đủ câu hỏi (Rê chuột xem chi tiết)</span></u>\`;
                    } else {
                        statusHtml = \`<span class="text-sm text-emerald-300 font-bold mt-1 drop-shadow-sm flex items-center gap-1">✅ Đáp ứng đủ \${total} câu hỏi</span></u>\`;
                    }
                    elInfo.innerHTML = \`<div class="flex flex-col items-end">
                        <span class="font-bold text-lg">\${total} câu - \${examConfig.timeLimit} phút</span></u>
                        \${statusHtml}
                    </div>\`;
                    elInfo.classList.remove('hidden');
                } else {
                    elInfo.innerHTML = \`<div class="flex flex-col items-end"><span class="text-sm text-yellow-300 font-bold mt-1 drop-shadow-sm">⚠️ Đề thi chưa cấu hình câu hỏi</span></u></div>\`;`;

const newCode = `                    if (!isEnough) {
                        statusHtml = \`<div class="text-[10px] md:text-xs text-red-500 font-bold flex items-center gap-1 ml-2" title="\${countDetails}">❌ Thiếu câu hỏi</div>\`;
                        elInfo.className = 'inline-flex items-center justify-center px-2 py-1 bg-red-100 text-red-700 font-bold text-xs md:text-sm rounded-lg whitespace-nowrap border border-red-200';
                    } else {
                        statusHtml = \`<div class="text-[10px] md:text-xs text-emerald-500 font-bold flex items-center gap-1 ml-2">✅ Đủ câu hỏi</div>\`;
                        elInfo.className = 'inline-flex items-center justify-center px-2.5 py-1 bg-emerald-600 text-white font-bold text-xs md:text-sm rounded-lg whitespace-nowrap shadow-sm';
                    }
                    
                    const container = document.getElementById('current-exam-info-container');
                    if (container) {
                        // Remove old status if exists
                        const oldStatus = container.querySelector('.status-indicator');
                        if(oldStatus) oldStatus.remove();
                        container.insertAdjacentHTML('beforeend', \`<div class="status-indicator">\${statusHtml}</div>\`);
                    }

                    elInfo.innerHTML = \`\${total} câu - \${examConfig.timeLimit} phút\`;
                    elInfo.classList.remove('hidden');
                } else {
                    elInfo.className = 'inline-flex items-center justify-center px-2 py-1 bg-yellow-100 text-yellow-700 font-bold text-xs md:text-sm rounded-lg whitespace-nowrap border border-yellow-200';
                    elInfo.innerHTML = \`⚠️ Chưa cấu hình\`;
                    const container = document.getElementById('current-exam-info-container');
                    if (container) {
                        const oldStatus = container.querySelector('.status-indicator');
                        if(oldStatus) oldStatus.remove();
                    }
                    elInfo.classList.remove('hidden');`;

content = content.replace(oldCode, newCode);
fs.writeFileSync('src/main.js', content);
console.log("updateCurrentExamInfo patched.");
