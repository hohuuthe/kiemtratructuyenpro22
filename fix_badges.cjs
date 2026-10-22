const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldHeader = `<div class="flex items-center justify-between gap-3 mb-5 w-full border-b border-gray-200/30 pb-5">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="inline-flex px-3 py-1 bg-blue-500 text-white text-[10px] md:text-xs font-black rounded-lg shadow-md shadow-blue-200 uppercase tracking-tight">\${q.type}</span>
                                    <span class="inline-flex px-3 py-1 bg-emerald-500 text-white text-[10px] md:text-xs font-black rounded-lg shadow-md shadow-emerald-200 uppercase tracking-tight">\${q.level || 'NB'}</span>
                                    <span class="inline-flex items-center px-2 py-1 bg-amber-50 text-amber-700 text-[10px] md:text-xs font-bold rounded-lg border border-amber-200 shadow-xs truncate max-w-[150px] md:max-w-none">
                                        <svg class="w-3 h-3 mr-1.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18 18.247 18.477 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                                        \${escapeHTML(q.lesson) || 'Chung'}
                                    </span>
                                    \${q.creatorId ? \`<span class="inline-flex items-center px-2 py-1 bg-indigo-50 text-indigo-800 text-[10px] md:text-xs font-bold rounded-lg border border-indigo-200 shadow-xs truncate max-w-full">
                                        <svg class="w-3 h-3 mr-1.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                        \${accounts.find(a => a.id === q.creatorId)?.full_name || 'Không xác định'}
                                    </span>\` : ''}
                                </div>
                                <button onclick="switchTab('exam')" title="Quay về Bảng điều khiển câu hỏi" class="flex-shrink-0 p-2 md:px-5 md:py-2.5 bg-white text-emerald-600 rounded-2xl hover:bg-emerald-50 transition-all shadow-lg shadow-emerald-100 border border-emerald-100 flex items-center gap-2 text-[10px] md:text-xs font-black hover:scale-110 active:scale-90 animate-pulse-slow">
                                    <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
                                    Bảng C/H
                                </button>
                            </div>`;
                            
const oldHeader2 = `<div class="flex items-center justify-between gap-3 mb-3 w-full border-b border-gray-200/30 pb-3">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="inline-flex px-3 py-1 bg-blue-500 text-white text-[10px] md:text-xs font-black rounded-lg shadow-md shadow-blue-200 uppercase tracking-tight">\${q.type}</span>
                                    <span class="inline-flex px-3 py-1 bg-emerald-500 text-white text-[10px] md:text-xs font-black rounded-lg shadow-md shadow-emerald-200 uppercase tracking-tight">\${q.level || 'NB'}</span>
                                    <span class="inline-flex items-center px-2 py-1 bg-amber-50 text-amber-700 text-[10px] md:text-xs font-bold rounded-lg border border-amber-200 shadow-xs truncate max-w-[150px] md:max-w-none">
                                        <svg class="w-3 h-3 mr-1.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18 18.247 18.477 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                                        \${escapeHTML(q.lesson) || 'Chung'}
                                    </span>
                                    \${q.creatorId ? \`<span class="inline-flex items-center px-2 py-1 bg-indigo-50 text-indigo-800 text-[10px] md:text-xs font-bold rounded-lg border border-indigo-200 shadow-xs truncate max-w-full">
                                        <svg class="w-3 h-3 mr-1.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                        \${accounts.find(a => a.id === q.creatorId)?.full_name || 'Không xác định'}
                                    </span>\` : ''}
                                </div>
                                <button onclick="switchTab('exam')" title="Quay về Bảng điều khiển câu hỏi" class="flex-shrink-0 p-2 md:px-3 md:py-1.5 bg-white text-emerald-600 rounded-xl hover:bg-emerald-50 transition-all shadow-sm border border-emerald-100 flex items-center gap-1.5 text-[10px] md:text-xs font-black">
                                    <svg class="w-4 h-4 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
                                    Bảng C/H
                                </button>
                            </div>`;

const newHeader = `<div class="flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-3 mb-3 w-full border-b border-gray-200/30 pb-3">
                                <div class="flex items-center justify-between w-full md:w-auto">
                                    <div class="flex items-center gap-2">
                                        <span class="inline-flex px-3 py-1 bg-blue-500 text-white text-[10px] md:text-xs font-black rounded-lg shadow-md shadow-blue-200 uppercase tracking-tight">\${q.type}</span>
                                        <span class="inline-flex px-3 py-1 bg-emerald-500 text-white text-[10px] md:text-xs font-black rounded-lg shadow-md shadow-emerald-200 uppercase tracking-tight">\${q.level || 'NB'}</span>
                                    </div>
                                    <button onclick="switchTab('exam')" title="Quay về Bảng điều khiển câu hỏi" class="md:hidden flex-shrink-0 px-2.5 py-1.5 bg-white text-emerald-600 rounded-lg hover:bg-emerald-50 shadow-sm border border-emerald-100 flex items-center gap-1 text-[10px] font-black">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
                                        Bảng C/H
                                    </button>
                                </div>
                                <div class="flex flex-wrap items-center gap-2 w-full md:w-auto flex-1">
                                    <span class="inline-flex items-center px-2 py-1 bg-amber-50 text-amber-700 text-[10px] md:text-xs font-bold rounded-lg border border-amber-200 shadow-xs truncate max-w-[150px] md:max-w-none">
                                        <svg class="w-3 h-3 mr-1.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18 18.247 18.477 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                                        \${escapeHTML(q.lesson) || 'Chung'}
                                    </span>
                                    \${q.creatorId ? \`<span class="inline-flex items-center px-2 py-1 bg-indigo-50 text-indigo-800 text-[10px] md:text-xs font-bold rounded-lg border border-indigo-200 shadow-xs truncate max-w-full">
                                        <svg class="w-3 h-3 mr-1.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                        \${accounts.find(a => a.id === q.creatorId)?.full_name || 'Không xác định'}
                                    </span>\` : ''}
                                </div>
                                <button onclick="switchTab('exam')" title="Quay về Bảng điều khiển câu hỏi" class="hidden md:flex flex-shrink-0 p-2 md:px-3 md:py-1.5 bg-white text-emerald-600 rounded-xl hover:bg-emerald-50 transition-all shadow-sm border border-emerald-100 items-center gap-1.5 text-[10px] md:text-xs font-black">
                                    <svg class="w-4 h-4 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
                                    Bảng C/H
                                </button>
                            </div>`;

if (content.includes(oldHeader)) {
    content = content.replace(oldHeader, newHeader);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched oldHeader successfully!");
} else if (content.includes(oldHeader2)) {
    content = content.replace(oldHeader2, newHeader);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched oldHeader2 successfully!");
} else {
    console.log("Header not found!");
}
