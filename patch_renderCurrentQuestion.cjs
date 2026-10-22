const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Also we need to apply the css vars globally when displaying the list mode
const targetStr = `            const currentFontSize = appSettings.questionFontSize || 24;
            const currentAnswerFontSize = appSettings.answerFontSize || 20;
            
            if (appSettings.displayMode === 'list') {`;

const newStr = `            const currentFontSize = appSettings.questionFontSize || 24;
            const currentAnswerFontSize = appSettings.answerFontSize || 20;
            
            setTimeout(() => {
                document.querySelectorAll('.responsive-q-text').forEach(el => {
                    el.style.setProperty('--base-q-size', \`\${currentFontSize}px\`);
                });
                document.querySelectorAll('.responsive-a-text').forEach(el => {
                    el.style.setProperty('--base-a-size', \`\${currentAnswerFontSize}px\`);
                });
            }, 10);
            
            if (appSettings.displayMode === 'list') {`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched renderCurrentQuestion variables");
} else {
    console.log("Target not found!");
}
