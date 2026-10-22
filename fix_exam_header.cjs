const fs = require('fs');
const file = 'public/components/tab-exam.html';
let content = fs.readFileSync(file, 'utf8');

const oldHTML = `        <div class="flex-1">
         <p class="text-xs font-medium text-emerald-600 uppercase tracking-wider mb-1">Thí sinh</p>
         <p id="exam-student-name" class="font-black text-gray-800 text-xl md:text-3xl break-words w-full max-w-[90vw]"></p>
         <div class="mt-2 flex items-center gap-2">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium bg-emerald-100 text-emerald-800">
            Đề thi
          </span>
          <p id="exam-title" class="font-bold text-gray-700 break-words w-full" style="font-size: clamp(1rem, 2.5vw, 1.4rem);"></p>
         </div>
         <div class="mt-1 text-sm font-semibold text-gray-600 italic">
          Người tạo đề thi: <span id="exam-creator-name-running" class="text-emerald-600" style="font-size: 1.2rem;"></span>
         </div>
        </div>
        <div class="flex flex-wrap items-center justify-center sm:justify-between md:justify-end gap-3 md:gap-6 bg-white/80 backdrop-blur-sm p-3 md:p-4 rounded-2xl shadow-sm border border-white/50 w-full overflow-hidden">`;

const newHTML = `        <div class="flex-1 min-w-0 flex flex-col justify-center space-y-2 md:space-y-3">
         <div class="flex items-center gap-2 md:gap-3 w-full">
          <span class="inline-flex flex-shrink-0 items-center px-2 py-0.5 rounded border border-emerald-200 text-[10px] md:text-xs font-bold uppercase tracking-wider bg-emerald-100/50 text-emerald-700">Thí sinh</span>
          <span id="exam-student-name" class="font-black text-gray-800 text-base md:text-2xl truncate"></span>
         </div>
         <div class="flex items-center gap-2 md:gap-3 w-full">
          <span class="inline-flex flex-shrink-0 items-center px-2 py-0.5 rounded border border-emerald-200 text-[10px] md:text-xs font-bold uppercase tracking-wider bg-emerald-100/50 text-emerald-700">Đề thi</span>
          <span id="exam-title" class="font-bold text-gray-700 text-sm md:text-lg truncate"></span>
         </div>
         <div class="flex items-center gap-2 md:gap-3 w-full">
          <span class="inline-flex flex-shrink-0 items-center px-2 py-0.5 rounded border border-emerald-200 text-[10px] md:text-xs font-bold uppercase tracking-wider bg-emerald-100/50 text-emerald-700">Giáo viên</span>
          <span id="exam-creator-name-running" class="font-semibold text-gray-600 text-sm md:text-base truncate"></span>
         </div>
        </div>
        <div class="flex flex-wrap items-center justify-center sm:justify-between md:justify-end gap-3 md:gap-6 bg-white/80 backdrop-blur-sm p-3 md:p-4 rounded-2xl shadow-sm border border-white/50 w-full md:w-auto overflow-hidden">`;

if (content.includes(oldHTML)) {
    content = content.replace(oldHTML, newHTML);
    fs.writeFileSync(file, content);
    console.log("Patched tab-exam.html successfully!");
} else {
    console.log("Could not find old HTML");
}
