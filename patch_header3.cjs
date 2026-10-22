const fs = require('fs');
let content = fs.readFileSync('public/components/tab-exam.html', 'utf8');

// Replace padding and gap on the main header
content = content.replace(
    /class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl shadow-sm p-3 md:p-4 mb-3 border border-emerald-100 relative overflow-hidden"/g,
    'class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl shadow-sm p-2 md:p-3 mb-2 border border-emerald-100 relative overflow-hidden"'
);

content = content.replace(
    /class="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10"/g,
    'class="flex flex-col md:flex-row md:items-center justify-between gap-2 relative z-10"'
);

// Progress Bar padding/margin
content = content.replace(
    /class="flex justify-between text-\[10px\] md:text-xs font-semibold text-indigo-800 mb-1 leading-none"/g,
    'class="flex justify-between text-[10px] md:text-xs font-semibold text-indigo-800 mb-0.5 leading-none"'
);

content = content.replace(
    /class="flex-1 min-w-0 flex flex-col justify-center space-y-1.5"/g,
    'class="flex-1 min-w-0 flex flex-col justify-center space-y-1"'
);

fs.writeFileSync('public/components/tab-exam.html', content);
console.log("Patched tab-exam.html more compactly");
