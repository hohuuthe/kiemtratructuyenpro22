const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldCode = "return `<button onclick=\"goToQuestion(${i})\" class=\"question-nav-btn w-10 h-10 md:w-11 md:h-11 rounded-xl font-bold transition-all duration-200 ${btnClass}\">${i + 1}</button>`;";
const newCode = "return `<button onclick=\"goToQuestion(${i})\" class=\"question-nav-btn w-8 h-8 md:w-9 md:h-9 text-xs md:text-sm rounded-lg font-semibold transition-all duration-200 ${btnClass}\">${i + 1}</button>`;";

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched src/main.js successfully!");
} else {
    console.log("Could not find the old code in src/main.js");
}
