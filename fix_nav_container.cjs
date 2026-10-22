const fs = require('fs');
const file = 'public/components/tab-exam.html';
let content = fs.readFileSync(file, 'utf8');

const oldNav = `<!-- Question Navigation -->
      <div class="bg-white rounded-2xl shadow-lg p-5 mb-6 border border-gray-100">
       <div class="flex items-center gap-2 mb-3">
        <svg class="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path></svg>
        <p class="text-sm font-bold text-gray-700 uppercase tracking-wider">Bảng điều hướng</p>
       </div>
       <div id="question-nav" class="flex flex-wrap gap-2 max-h-[350px] md:max-h-[650px] overflow-y-auto p-1 custom-scrollbar"></div>
      </div>`;

const newNav = `<!-- Question Navigation -->
      <div class="bg-white rounded-xl shadow-md p-3 md:p-4 mb-4 border border-gray-100">
       <div class="flex items-center gap-1.5 mb-2 md:mb-3">
        <svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path></svg>
        <p class="text-xs md:text-sm font-bold text-gray-700 uppercase tracking-wider">Bảng điều hướng</p>
       </div>
       <div id="question-nav" class="flex flex-wrap gap-1 md:gap-1.5 max-h-[120px] md:max-h-[200px] overflow-y-auto p-0.5 custom-scrollbar"></div>
      </div>`;

if (content.includes(oldNav)) {
    content = content.replace(oldNav, newNav);
    fs.writeFileSync(file, content);
    console.log("Patched tab-exam.html successfully!");
} else {
    console.log("Could not find the old HTML snippet.");
}
