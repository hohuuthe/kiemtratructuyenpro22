const fs = require('fs');
let content = fs.readFileSync('public/components/tab-exam.html', 'utf8');

// Replace main padding
content = content.replace(
    /class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl shadow-lg p-5 mb-6 border border-emerald-100 relative overflow-hidden"/g,
    'class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl shadow-sm p-3 md:p-4 mb-3 border border-emerald-100 relative overflow-hidden"'
);

// Replace flex space-y
content = content.replace(
    /class="flex-1 min-w-0 flex flex-col justify-center space-y-2 md:space-y-3"/g,
    'class="flex-1 min-w-0 flex flex-col justify-center space-y-1.5"'
);

// Replace label wrappers
content = content.replace(
    /class="inline-flex flex-shrink-0 items-center px-2 py-0.5 rounded border border-emerald-200 text-\[10px\] md:text-xs font-bold uppercase tracking-wider bg-emerald-100\/50 text-emerald-700"/g,
    'class="inline-flex flex-shrink-0 items-center px-1.5 py-0.5 rounded border border-emerald-200 text-[9px] md:text-[10px] font-bold uppercase tracking-wider bg-emerald-100/50 text-emerald-700 leading-none"'
);

// Replace student name text size
content = content.replace(
    /id="exam-student-name" class="font-black text-gray-800 text-base md:text-2xl truncate"/g,
    'id="exam-student-name" class="font-black text-gray-800 text-sm md:text-lg truncate leading-tight"'
);

// Replace exam title text size
content = content.replace(
    /id="exam-title" class="font-bold text-gray-700 text-sm md:text-lg truncate"/g,
    'id="exam-title" class="font-bold text-gray-700 text-xs md:text-sm truncate leading-tight"'
);

// Replace creator name text size
content = content.replace(
    /id="exam-creator-name-running" class="font-semibold text-gray-600 text-sm md:text-base truncate"/g,
    'id="exam-creator-name-running" class="font-semibold text-gray-600 text-xs md:text-sm truncate leading-tight"'
);

// Replace timer/cheat box padding
content = content.replace(
    /class="flex flex-wrap items-center justify-center sm:justify-between md:justify-end gap-3 md:gap-6 bg-white\/80 backdrop-blur-sm p-3 md:p-4 rounded-2xl shadow-sm border border-white\/50 w-full md:w-auto overflow-hidden"/g,
    'class="flex flex-wrap items-center justify-center sm:justify-between md:justify-end gap-2 md:gap-4 bg-white/80 backdrop-blur-sm p-2 md:p-2.5 rounded-xl shadow-sm border border-white/50 w-full md:w-auto overflow-hidden"'
);

// Replace timer font size
content = content.replace(
    /style="font-size: clamp\(2rem, 5vw, 4rem\); font-variant-numeric: tabular-nums;"/g,
    'style="font-size: clamp(1.5rem, 3.5vw, 2.2rem); font-variant-numeric: tabular-nums;" class="font-black text-rose-600 tracking-tight leading-none mt-1"'
);

// Replace "Thời gian" p tag margin
content = content.replace(
    /class="text-\[10px\] md:text-sm font-bold text-gray-500 uppercase tracking-widest mb-1 flex items-center justify-center gap-1"/g,
    'class="text-[9px] md:text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-0 flex items-center justify-center gap-1"'
);

// Replace line separator
content = content.replace(
    /class="h-10 md:h-12 w-px bg-gray-200"/g,
    'class="h-8 md:h-10 w-px bg-gray-200"'
);

// Replace cheat wrapper padding
content = content.replace(
    /class="hidden text-center bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-xl shadow-2xs"/g,
    'class="hidden text-center bg-amber-50 border border-amber-200 px-1.5 py-1 rounded-lg shadow-2xs"'
);

// Replace cheat wrapper text
content = content.replace(
    /class="text-\[9px\] md:text-\[10px\] font-bold text-amber-700 uppercase tracking-wider flex items-center justify-center gap-1"/g,
    'class="text-[8px] md:text-[9px] font-bold text-amber-700 uppercase tracking-wider flex items-center justify-center gap-1 mb-0.5"'
);

// Replace cheat wrapper count text
content = content.replace(
    /class="text-xs md:text-sm font-black text-amber-900 leading-tight"/g,
    'class="text-[10px] md:text-[11px] font-black text-amber-900 leading-none"'
);

// Replace progress bar container margin
content = content.replace(
    /class="mt-5 relative z-10"/g,
    'class="mt-2 relative z-10"'
);

// Replace progress bar header font size
content = content.replace(
    /class="flex justify-between text-sm font-semibold text-indigo-800 mb-2"/g,
    'class="flex justify-between text-[10px] md:text-xs font-semibold text-indigo-800 mb-1 leading-none"'
);

// Replace progress bar text size
content = content.replace(
    /class="bg-indigo-100 px-2 py-0.5 rounded-md"/g,
    'class="bg-indigo-100 px-1.5 py-0.5 rounded text-[9px] md:text-[10px] flex items-center"'
);

// Replace progress bar height
content = content.replace(
    /class="h-3 bg-indigo-100\/50 rounded-full overflow-hidden border border-indigo-100\/50 backdrop-blur-sm p-0.5"/g,
    'class="h-2 md:h-2.5 bg-indigo-100/50 rounded-full overflow-hidden border border-indigo-100/50 backdrop-blur-sm p-[1px]"'
);

// Replace fullscreen button padding/text size
content = content.replace(
    /class="group px-3 py-1.5 md:px-4 md:py-2 bg-indigo-50 text-indigo-700 font-bold text-xs md:text-sm rounded-xl/g,
    'class="group px-2 py-1.5 md:px-3 md:py-2 bg-indigo-50 text-indigo-700 font-bold text-[10px] md:text-xs rounded-lg'
);

// Replace submit exam padding/text size
content = content.replace(
    /class="group relative px-4 py-2 md:px-6 md:py-2.5 bg-gradient-to-r from-rose-500 to-red-600 text-white font-black text-sm md:text-base rounded-xl/g,
    'class="group relative px-3 py-1.5 md:px-4 md:py-2 bg-gradient-to-r from-rose-500 to-red-600 text-white font-black text-xs md:text-sm rounded-lg'
);


fs.writeFileSync('public/components/tab-exam.html', content);
console.log("Regex patch completed");
