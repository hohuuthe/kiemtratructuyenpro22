const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

content = content.replace(
    /class="flex-shrink-0 mb-3 bg-gray-50\/20 p-4 pb-2 rounded-2xl border border-gray-100\/50 shadow-inner"/g,
    'class="flex-shrink-0 mb-2 bg-gray-50/20 p-2 pb-1.5 rounded-xl border border-gray-100/50 shadow-inner"'
);

content = content.replace(
    /class="flex flex-col md:flex-row md:items-center justify-between gap-2 md:gap-3 mb-3 w-full border-b border-gray-200\/30 pb-3"/g,
    'class="flex flex-col md:flex-row md:items-center justify-between gap-1.5 mb-2 w-full border-b border-gray-200/30 pb-2"'
);

content = content.replace(
    /class="inline-flex px-3 py-1 bg-blue-500 text-white text-\[10px\] md:text-xs font-black rounded-lg shadow-md shadow-blue-200 uppercase tracking-tight"/g,
    'class="inline-flex px-2 py-0.5 bg-blue-500 text-white text-[9px] md:text-[10px] font-black rounded-md shadow-sm shadow-blue-200 uppercase tracking-tight"'
);

content = content.replace(
    /class="inline-flex px-3 py-1 bg-emerald-500 text-white text-\[10px\] md:text-xs font-black rounded-lg shadow-md shadow-emerald-200 uppercase tracking-tight"/g,
    'class="inline-flex px-2 py-0.5 bg-emerald-500 text-white text-[9px] md:text-[10px] font-black rounded-md shadow-sm shadow-emerald-200 uppercase tracking-tight"'
);

content = content.replace(
    /class="inline-flex items-center px-2 py-1 bg-amber-50 text-amber-700 text-\[10px\] md:text-xs font-bold rounded-lg/g,
    'class="inline-flex items-center px-1.5 py-0.5 bg-amber-50 text-amber-700 text-[9px] md:text-[10px] font-bold rounded-md'
);

content = content.replace(
    /class="inline-flex items-center px-2 py-1 bg-indigo-50 text-indigo-800 text-\[10px\] md:text-xs font-bold rounded-lg/g,
    'class="inline-flex items-center px-1.5 py-0.5 bg-indigo-50 text-indigo-800 text-[9px] md:text-[10px] font-bold rounded-md'
);

fs.writeFileSync('src/main.js', content);
console.log("Patched src/main.js renderCurrentQuestion spacing");
