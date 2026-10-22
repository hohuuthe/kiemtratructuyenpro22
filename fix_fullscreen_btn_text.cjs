const fs = require('fs');

let mainContent = fs.readFileSync('src/main.js', 'utf8');

mainContent = mainContent.replace(
    /btn\.innerHTML \= \`\<svg class\="w\-3\.5 h\-3\.5 md\:w\-4 md\:h\-4" fill\="none" stroke\="currentColor" viewBox\="0 0 24 24"\>\<path stroke\-linecap\="round" stroke\-linejoin\="round" stroke\-width\="2" d\="M6 18L18 6M6 6l12 12"\>\<\/path\>\<\/svg\> Thu nhỏ\`\;/g,
    `btn.innerHTML = \`<svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg> <span class="hidden sm:inline">Thu nhỏ</span><span class="sm:hidden text-[10px]">Thu nhỏ</span>\`;`
);

mainContent = mainContent.replace(
    /btn\.innerHTML \= \`\<svg class\="w\-3\.5 h\-3\.5 md\:w\-4 md\:h\-4" fill\="none" stroke\="currentColor" viewBox\="0 0 24 24"\>\<path stroke\-linecap\="round" stroke\-linejoin\="round" stroke\-width\="2" d\="M4 8V4m0 0h4M4 4l5 5m11\-1V4m0 0h\-4m4 0l\-5 5M4 16v4m0 0h4m\-4 0l5\-5m11 5l\-5\-5m5 5v\-4m0 4h\-4"\>\<\/path\>\<\/svg\> Toàn màn hình\`\;/g,
    `btn.innerHTML = \`<svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg> <span class="hidden sm:inline">Toàn màn hình</span><span class="sm:hidden text-[10px]">Toàn MH</span>\`;`
);

fs.writeFileSync('src/main.js', mainContent);
console.log("Updated fullscreen button text dynamically.");
