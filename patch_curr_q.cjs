const fs = require('fs');
let content = fs.readFileSync('public/components/tab-exam.html', 'utf8');

content = content.replace(
    /class="bg-white rounded-3xl shadow-xl p-6 md:p-8 flex flex-col h-auto border border-gray-100 relative overflow-hidden"/g,
    'class="bg-white rounded-2xl shadow-lg p-4 md:p-5 flex flex-col h-auto border border-gray-100 relative overflow-hidden"'
);

content = content.replace(
    /class="mb-8 pb-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4"/g,
    'class="mb-4 pb-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3"'
);

// Reduce padding on the question indicator boxes
content = content.replace(
    /class="bg-emerald-50 px-2 py-1 md:px-4 md:py-2 rounded-xl border border-emerald-100 flex-1 min-w-\[80px\] md:min-w-\[120px\] text-center"/g,
    'class="bg-emerald-50 px-1.5 py-1 md:px-2 md:py-1.5 rounded-lg border border-emerald-100 flex-1 min-w-[70px] md:min-w-[100px] text-center"'
);
content = content.replace(
    /class="bg-blue-50 px-2 py-1 md:px-4 md:py-2 rounded-xl border border-blue-100 flex-1 min-w-\[70px\] md:min-w-\[100px\] text-center"/g,
    'class="bg-blue-50 px-1.5 py-1 md:px-2 md:py-1.5 rounded-lg border border-blue-100 flex-1 min-w-[60px] md:min-w-[90px] text-center"'
);
content = content.replace(
    /class="bg-emerald-50 px-2 py-1 md:px-4 md:py-2 rounded-xl border border-emerald-100 flex-1 min-w-\[70px\] md:min-w-\[100px\] text-center"/g,
    'class="bg-emerald-50 px-1.5 py-1 md:px-2 md:py-1.5 rounded-lg border border-emerald-100 flex-1 min-w-[60px] md:min-w-[90px] text-center"'
);

// text sizes of labels
content = content.replace(
    /style="font-size: clamp\(1.8rem, 4.5vw, 3.8rem\);"/g,
    'style="font-size: clamp(1.2rem, 3.5vw, 2.5rem);"'
);
content = content.replace(
    /class="text-sm md:text-2xl font-black text-blue-700"/g,
    'class="text-sm md:text-xl font-black text-blue-700"'
);
content = content.replace(
    /class="text-sm md:text-2xl font-black text-emerald-700"/g,
    'class="text-sm md:text-xl font-black text-emerald-700"'
);

fs.writeFileSync('public/components/tab-exam.html', content);
console.log("Patched tab-exam.html current question block");
