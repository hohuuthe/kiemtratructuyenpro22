const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

content = content.replace(
    /let html = '<div class="space-y-8">';/g,
    'let html = \'<div class="space-y-4 md:space-y-6">\';'
);

content = content.replace(
    /class="bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm"/g,
    'class="bg-gray-50 p-3 md:p-4 rounded-xl border border-gray-200 shadow-sm"'
);

content = content.replace(
    /class="flex-shrink-0 mb-6"/g,
    'class="flex-shrink-0 mb-3 md:mb-4"'
);

content = content.replace(
    /class="flex items-center justify-between gap-2 mb-4 w-full border-b border-gray-100 pb-4"/g,
    'class="flex items-center justify-between gap-2 mb-3 w-full border-b border-gray-100 pb-3"'
);

content = content.replace(
    /class="font-bold text-gray-900 leading-tight responsive-q-text mb-4"/g,
    'class="font-bold text-gray-900 leading-tight responsive-q-text mb-2 md:mb-3"'
);

// also fix the label styling in list view
content = content.replace(
    /class="inline-flex px-2 py-0.5 bg-blue-50 text-blue-700 text-\[10px\] md:text-xs font-black rounded-lg/g,
    'class="inline-flex px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[9px] md:text-[10px] font-black rounded-md'
);

content = content.replace(
    /class="inline-flex px-2 py-0.5 bg-emerald-50 text-emerald-700 text-\[10px\] md:text-xs font-black rounded-lg/g,
    'class="inline-flex px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] md:text-[10px] font-black rounded-md'
);

fs.writeFileSync('src/main.js', content);
console.log("Patched list view layout");
