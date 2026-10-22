const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldSVG = `\${isSelected ? \`<div class="flex-shrink-0 text-indigo-500 ml-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg></div>\` : ''}`;
const newSVG = `\${isSelected ? \`<div class="flex-shrink-0 text-indigo-500 ml-2 hidden md:block"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg></div>\` : ''}`;

if (content.includes(oldSVG)) {
    content = content.replace(oldSVG, newSVG);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched SVG checkmark successfully!");
} else {
    console.log("SVG string not found.");
}
