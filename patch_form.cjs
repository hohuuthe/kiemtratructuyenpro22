const fs = require('fs');
const filePath = 'public/components/tab-exam.html';
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
    /class="bg-white rounded-xl shadow-lg p-5 md:p-6 mb-6 slide-up border border-gray-200 text-left"/g,
    'class="bg-white rounded-xl shadow-lg p-3 sm:p-5 md:p-6 mb-4 md:mb-6 slide-up border border-gray-200 text-left"'
);

content = content.replace(
    /text-xl md:text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3/g,
    'text-lg sm:text-xl md:text-2xl font-bold text-gray-800 mb-3 md:mb-6 flex items-center gap-2 md:gap-3'
);

content = content.replace(
    /id="student-info-inputs-row1" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"/g,
    'id="student-info-inputs-row1" class="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 mb-2 md:mb-4"'
);

content = content.replace(
    /id="student-info-inputs-row2" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"/g,
    'id="student-info-inputs-row2" class="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 mb-3 md:mb-6"'
);

content = content.replace(
    /mb-1\.5/g,
    'mb-1'
);

// Form controls padding
content = content.replace(
    /class="w-full px-4 py-2\.5 border/g,
    'class="w-full px-3 py-1.5 md:px-4 md:py-2.5 border'
);

// The exam details block
content = content.replace(
    /class="mb-6 p-4 bg-emerald-50\/50 rounded-xl border border-emerald-100 flex flex-col md:flex-row md:items-start justify-between gap-3"/g,
    'class="mb-4 md:mb-6 p-2.5 md:p-4 bg-emerald-50/50 rounded-xl border border-emerald-100 flex flex-col md:flex-row md:items-start justify-between gap-2 md:gap-3"'
);

// Button Start exam? I don't see it in my snippet but it should be below. 
// Let's just run this much.
fs.writeFileSync(filePath, content);
console.log("Form layout patched.");
