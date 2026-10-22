const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexSelect = /<div class="mb-4">\s*<label class="block text-sm font-semibold text-gray-700 mb-1">Phương thức đánh dấu đáp án đúng:<\/label>[\s\S]*?<\/select>\s*<\/div>/;

if (regexSelect.test(content)) {
    content = content.replace(regexSelect, "");
    fs.writeFileSync('src/main.js', content);
    console.log("Removed old select!");
} else {
    console.log("Regex for select not found!");
}
