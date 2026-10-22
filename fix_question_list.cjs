const fs = require('fs');
let htmlContent = fs.readFileSync('public/components/tab-questions.html', 'utf8');

const oldCode = `<div class="flex justify-between items-center mb-3">
           <h3 class="font-bold text-gray-800 text-sm">📋 Danh sách câu hỏi</h3>
            <div class="flex items-center gap-2 w-full md:w-auto">
                <input type="text" id="question-search" oninput="filterQuestions()" placeholder="🔍 Tìm kiếm câu hỏi..." class="flex-1 md:w-64 px-3 py-1.5 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none text-sm">
                <span id="questions-count" class="text-sm text-gray-600 font-semibold whitespace-nowrap">Tổng: 0 câu</span>
            </div>
          </div>`;

const newCode = `<div class="flex flex-col sm:flex-row justify-between sm:items-center gap-2 sm:gap-3 mb-3">
           <div class="flex items-center justify-between sm:justify-start w-full sm:w-auto">
             <h3 class="font-bold text-gray-800 text-sm flex items-center gap-1.5"><span>📋</span> Danh sách câu hỏi</h3>
             <span id="questions-count" class="text-xs text-purple-700 bg-purple-50 border border-purple-100 px-2.5 py-1 rounded-md font-bold whitespace-nowrap shadow-sm">Tổng: 0 câu</span>
           </div>
           <div class="w-full sm:w-auto relative group">
                <input type="text" id="question-search" oninput="filterQuestions()" placeholder="Tìm kiếm câu hỏi..." class="w-full sm:w-64 pl-9 pr-3 py-2 sm:py-1.5 border border-gray-200 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none text-sm transition-all shadow-sm group-hover:border-purple-300">
                <svg class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2 group-hover:text-purple-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
           </div>
          </div>`;

if (htmlContent.includes(oldCode)) {
    htmlContent = htmlContent.replace(oldCode, newCode);
    fs.writeFileSync('public/components/tab-questions.html', htmlContent);
    console.log("Replaced successfully.");
} else {
    // Let's try to match it more flexibly if spacing differs
    console.log("Could not find exact string. Creating regex.");
    const regex = /<div class="flex justify-between items-center mb-3">\s*<h3 class="font-bold text-gray-800 text-sm">📋 Danh sách câu hỏi<\/h3>\s*<div class="flex items-center gap-2 w-full md:w-auto">\s*<input type="text" id="question-search"[^>]*>\s*<span id="questions-count"[^>]*>Tổng: 0 câu<\/span>\s*<\/div>\s*<\/div>/;
    if (htmlContent.match(regex)) {
        htmlContent = htmlContent.replace(regex, newCode);
        fs.writeFileSync('public/components/tab-questions.html', htmlContent);
        console.log("Replaced successfully via regex.");
    } else {
        console.log("Regex failed too.");
    }
}
