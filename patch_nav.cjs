const fs = require('fs');
let content = fs.readFileSync('public/components/tab-exam.html', 'utf8');

// Reduce nav container paddings even more
content = content.replace(
    /class="bg-white rounded-xl shadow-sm p-2 md:p-3 mb-2 border border-gray-100"/g,
    'class="bg-white rounded-lg shadow-sm p-1.5 md:p-2 mb-2 border border-gray-100"'
);

// Nav header margin and font size reduction
content = content.replace(
    /class="flex items-center justify-between mb-1.5 md:mb-2"/g,
    'class="flex items-center justify-between mb-1"'
);
content = content.replace(
    /class="text-xs md:text-sm font-bold text-gray-700 uppercase tracking-wider"/g,
    'class="text-[10px] md:text-[11px] font-bold text-gray-700 uppercase tracking-wider"'
);

// Reduce max-height by 30% (80px -> 56px, 120px -> 84px)
content = content.replace(
    /max-h-\[80px\] md:max-h-\[120px\]/g,
    'max-h-[56px] md:max-h-[84px]'
);

// Reduce gap in the nav grid
content = content.replace(
    /gap-1 md:gap-1.5 max-h-\[56px\] md:max-h-\[84px\] overflow-y-auto p-0.5 custom-scrollbar/g,
    'gap-0.5 md:gap-1 max-h-[56px] md:max-h-[84px] overflow-y-auto p-0.5 custom-scrollbar'
);

fs.writeFileSync('public/components/tab-exam.html', content);
console.log("Patched tab-exam.html question nav container");
