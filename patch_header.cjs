const fs = require('fs');
let content = fs.readFileSync('public/components/tab-exam.html', 'utf8');

const oldStr = `      <!-- Exam Header -->
      <div class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl shadow-lg p-5 mb-6 border border-emerald-100 relative overflow-hidden">
       <div class="absolute top-0 right-0 w-32 h-32 bg-emerald-200 rounded-full mix-blend-multiply filter blur-2xl opacity-50 animate-blob"></div>
       <div class="absolute top-0 right-32 w-32 h-32 bg-teal-200 rounded-full mix-blend-multiply filter blur-2xl opacity-50 animate-blob animation-delay-2000"></div>
       <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
        <div class="flex-1 min-w-0 flex flex-col justify-center space-y-2 md:space-y-3">
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
        <div class="flex flex-wrap items-center justify-center sm:justify-between md:justify-end gap-3 md:gap-6 bg-white/80 backdrop-blur-sm p-3 md:p-4 rounded-2xl shadow-sm border border-white/50 w-full md:w-auto overflow-hidden">
         <div class="text-center">
          <p class="text-[10px] md:text-sm font-bold text-gray-500 uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
            <svg class="w-3 h-3 md:w-4 md:h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Thời gian
          </p>
          <p id="exam-timer" class="font-black text-rose-600 tracking-tight" style="font-size: clamp(2rem, 5vw, 4rem); font-variant-numeric: tabular-nums;">00:00</p>
         </div>
         <div class="h-10 md:h-12 w-px bg-gray-200"></div>
         <div id="cheat-indicator-wrapper" class="hidden text-center bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-xl shadow-2xs">
           <p class="text-[9px] md:text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center justify-center gap-1">
             <svg class="w-3 h-3 text-amber-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
             Rời phòng thi
           </p>
           <p id="cheat-warning-count" class="text-xs md:text-sm font-black text-amber-900 leading-tight">0/3 lần</p>
         </div>
         <div class="flex gap-2">
           <button onclick="toggleExamFullscreen()" id="btn-exam-fullscreen" class="group px-3 py-1.5 md:px-4 md:py-2 bg-indigo-50 text-indigo-700 font-bold text-xs md:text-sm rounded-xl hover:bg-indigo-100 transition-all border border-indigo-200 shadow-sm flex items-center justify-center gap-1.5">
             <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
             <span class="hidden sm:inline">Toàn màn hình</span><span class="sm:hidden text-[10px]">Toàn MH</span>
           </button>
           <button onclick="submitExam()" class="group relative px-4 py-2 md:px-6 md:py-2.5 bg-gradient-to-r from-rose-500 to-red-600 text-white font-black text-sm md:text-base rounded-xl hover:from-rose-600 hover:to-red-700 transition-all shadow-md hover:shadow-xl hover:-translate-y-0.5 overflow-hidden">
          <span class="relative z-10 flex items-center gap-2">
            <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <span>Nộp bài</span>
          </span>
          <div class="absolute inset-0 h-full w-full bg-white/20 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
         </button>
        </div>
        </div>
       </div>
       <!-- Progress Bar -->
       <div class="mt-5 relative z-10">
        <div class="flex justify-between text-sm font-semibold text-indigo-800 mb-2">
         <span class="flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
            Tiến độ làm bài
         </span>
          <span id="progress-text" class="bg-indigo-100 px-2 py-0.5 rounded-md">0/0</span>
        </div>
        <div class="h-3 bg-indigo-100/50 rounded-full overflow-hidden border border-indigo-100/50 backdrop-blur-sm p-0.5">
         <div id="progress-bar" class="progress-bar h-full bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500 rounded-full shadow-sm relative" style="width: 0%">
            <div class="absolute inset-0 bg-white/20 w-full h-full animate-pulse"></div>
         </div>
        </div>
       </div>
      </div>`;

const newStr = `      <!-- Exam Header -->
      <div class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl shadow-sm p-3 md:p-4 mb-3 border border-emerald-100 relative overflow-hidden">
       <div class="absolute top-0 right-0 w-32 h-32 bg-emerald-200 rounded-full mix-blend-multiply filter blur-2xl opacity-50 animate-blob"></div>
       <div class="absolute top-0 right-32 w-32 h-32 bg-teal-200 rounded-full mix-blend-multiply filter blur-2xl opacity-50 animate-blob animation-delay-2000"></div>
       <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 relative z-10">
        <div class="flex-1 min-w-0 flex flex-col justify-center space-y-1.5 md:space-y-1.5">
         <div class="flex items-center gap-2 md:gap-2.5 w-full">
          <span class="inline-flex flex-shrink-0 items-center px-1.5 py-0.5 rounded border border-emerald-200 text-[9px] md:text-[10px] font-bold uppercase tracking-wider bg-emerald-100/50 text-emerald-700 leading-none">Thí sinh</span>
          <span id="exam-student-name" class="font-black text-gray-800 text-sm md:text-lg truncate leading-tight"></span>
         </div>
         <div class="flex items-center gap-2 md:gap-2.5 w-full">
          <span class="inline-flex flex-shrink-0 items-center px-1.5 py-0.5 rounded border border-emerald-200 text-[9px] md:text-[10px] font-bold uppercase tracking-wider bg-emerald-100/50 text-emerald-700 leading-none">Đề thi</span>
          <span id="exam-title" class="font-bold text-gray-700 text-xs md:text-sm truncate leading-tight"></span>
         </div>
         <div class="flex items-center gap-2 md:gap-2.5 w-full">
          <span class="inline-flex flex-shrink-0 items-center px-1.5 py-0.5 rounded border border-emerald-200 text-[9px] md:text-[10px] font-bold uppercase tracking-wider bg-emerald-100/50 text-emerald-700 leading-none">Giáo viên</span>
          <span id="exam-creator-name-running" class="font-semibold text-gray-600 text-xs md:text-sm truncate leading-tight"></span>
         </div>
        </div>
        <div class="flex flex-wrap items-center justify-center sm:justify-between md:justify-end gap-2 md:gap-4 bg-white/80 backdrop-blur-sm p-2 md:p-2.5 rounded-xl shadow-sm border border-white/50 w-full md:w-auto overflow-hidden">
         <div class="text-center">
          <p class="text-[9px] md:text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-0 flex items-center justify-center gap-1">
            <svg class="w-2.5 h-2.5 md:w-3 md:h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Thời gian
          </p>
          <p id="exam-timer" class="font-black text-rose-600 tracking-tight leading-none mt-1" style="font-size: clamp(1.5rem, 3.5vw, 2.2rem); font-variant-numeric: tabular-nums;">00:00</p>
         </div>
         <div class="h-8 md:h-10 w-px bg-gray-200"></div>
         <div id="cheat-indicator-wrapper" class="hidden text-center bg-amber-50 border border-amber-200 px-1.5 py-1 rounded-lg shadow-2xs">
           <p class="text-[8px] md:text-[9px] font-bold text-amber-700 uppercase tracking-wider flex items-center justify-center gap-1 mb-0.5">
             <svg class="w-2.5 h-2.5 text-amber-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
             Rời phòng
           </p>
           <p id="cheat-warning-count" class="text-[10px] md:text-[11px] font-black text-amber-900 leading-none">0/3 lần</p>
         </div>
         <div class="flex gap-1.5 md:gap-2">
           <button onclick="toggleExamFullscreen()" id="btn-exam-fullscreen" class="group px-2.5 py-1.5 md:px-3 md:py-2 bg-indigo-50 text-indigo-700 font-bold text-[10px] md:text-xs rounded-lg hover:bg-indigo-100 transition-all border border-indigo-200 shadow-sm flex items-center justify-center gap-1">
             <svg class="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
             <span class="hidden sm:inline">Toàn MH</span>
           </button>
           <button onclick="submitExam()" class="group relative px-3 py-1.5 md:px-4 md:py-2 bg-gradient-to-r from-rose-500 to-red-600 text-white font-black text-[11px] md:text-xs rounded-lg hover:from-rose-600 hover:to-red-700 transition-all shadow-md hover:shadow-xl hover:-translate-y-0.5 overflow-hidden">
          <span class="relative z-10 flex items-center gap-1.5">
            <svg class="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <span>Nộp bài</span>
          </span>
          <div class="absolute inset-0 h-full w-full bg-white/20 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
         </button>
        </div>
        </div>
       </div>
       <!-- Progress Bar -->
       <div class="mt-2.5 md:mt-3 relative z-10">
        <div class="flex justify-between text-[10px] md:text-xs font-semibold text-indigo-800 mb-1">
         <span class="flex items-center gap-1 leading-none">
            <svg class="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
            Tiến độ
         </span>
          <span id="progress-text" class="bg-indigo-100 px-1.5 py-0.5 rounded text-[9px] md:text-[10px] leading-none flex items-center">0/0</span>
        </div>
        <div class="h-2 md:h-2 bg-indigo-100/50 rounded-full overflow-hidden border border-indigo-100/50 backdrop-blur-sm p-[1px]">
         <div id="progress-bar" class="progress-bar h-full bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500 rounded-full shadow-sm relative" style="width: 0%">
            <div class="absolute inset-0 bg-white/20 w-full h-full animate-pulse"></div>
         </div>
        </div>
       </div>
      </div>`;

if (content.includes(oldStr)) {
    content = content.replace(oldStr, newStr);
    fs.writeFileSync('public/components/tab-exam.html', content);
    console.log("Patched tab-exam.html successfully");
} else {
    console.log("Could not find the target string in tab-exam.html");
}
