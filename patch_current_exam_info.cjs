const fs = require('fs');
let content = fs.readFileSync('public/components/tab-exam.html', 'utf8');

const regex = /<div class="mb-4 md:mb-6 p-2\.5 md:p-4 bg-emerald-50\/50 rounded-xl border border-emerald-100 flex flex-col md:flex-row md:items-start justify-between gap-2 md:gap-3">[\s\S]*?<div id="exam-access-info"/m;

const newBlock = `<div class="mb-4 md:mb-6 p-3 md:p-4 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-100/60 shadow-sm flex flex-col gap-2 relative">
       <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
         <div class="flex items-center gap-1.5 text-xs font-bold text-emerald-600 uppercase tracking-wide mb-0.5">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
          Đề thi hiện tại
         </div>
         <div id="current-exam-name" class="font-bold text-emerald-900 text-sm md:text-lg break-words leading-tight">Chưa có đề thi</div>
        </div>
       </div>
       <div class="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200/50 pt-2 mt-0.5">
        <div class="flex items-center gap-1.5 text-xs md:text-sm text-gray-600">
         <svg class="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
         <span class="font-medium">Người tạo:</span>
         <span id="exam-creator-name" class="font-bold text-gray-700 truncate max-w-[150px] md:max-w-[200px]"></span>
        </div>
        <div id="current-exam-info-container" class="shrink-0 flex items-center justify-end">
         <span id="current-exam-info" class="inline-flex items-center justify-center px-2.5 py-1 bg-emerald-600 text-white font-bold text-xs md:text-sm rounded-lg whitespace-nowrap shadow-sm"></span>
        </div>
       </div>
      </div>
      <div id="exam-access-info"`;

content = content.replace(regex, newBlock);
fs.writeFileSync('public/components/tab-exam.html', content);
console.log("Replaced current exam info HTML block");
