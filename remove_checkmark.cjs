const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `                            </div>
                            \${isSelected ? \`<div class="flex-shrink-0 text-indigo-500 ml-2 hidden md:block"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg></div>\` : ''}
                        </div>`;

const newStr = `                            </div>
                        </div>`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched renderMultipleChoice to remove checkmark!");
} else {
    console.log("Target not found!");
}
