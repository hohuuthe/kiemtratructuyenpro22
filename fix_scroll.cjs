const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldButton = `onclick="const c = document.getElementById('question-content-display'); if(c) c.scrollTo({top: 0, behavior: 'smooth'}); window.scrollTo({top: 0, behavior: 'smooth'}); document.getElementById('exam-interface').scrollIntoView({behavior: 'smooth', block: 'start'});"`;
const newButton = `onclick="const scrollContainer = document.getElementById('exam-interface').closest('.overflow-y-auto') || document.getElementById('exam-interface').parentElement; if(scrollContainer) scrollContainer.scrollTo({top: 0, behavior: 'smooth'}); document.getElementById('exam-interface').scrollIntoView({behavior: 'smooth', block: 'start'}); window.scrollTo({top: 0, behavior: 'smooth'}); document.getElementById('question-content-display').scrollTo({top: 0, behavior: 'smooth'});"`;

if (content.includes(oldButton)) {
    content = content.replace(oldButton, newButton);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched scroll up button successfully!");
} else {
    console.log("Button not found.");
}
