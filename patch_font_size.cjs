const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Replace standard variables with actual appSettings lookup on render
content = content.replace(/\$\{appSettings\.questionFontSize \|\| 24\}/g, '${appSettings.questionFontSize || 24}');
content = content.replace(/\$\{appSettings\.answerFontSize \|\| 20\}/g, '${appSettings.answerFontSize || 20}');

// Let's modify updateStudentSettings to also manually update CSS vars for immediate effect 
// without re-rendering if we don't want a full flash, OR just ensure re-render happens.
// Wait, the re-render happens, but if options were already rendered, maybe the CSS var isn't updating correctly?

const targetStr = `        window.updateStudentSettings = function updateStudentSettings() {
            // First ensure modal elements exist to avoid classList errors on null elements
            const modal = document.getElementById('student-settings-modal');
            if (!modal) return;
            const qSize = parseInt(document.getElementById('student-settings-question-font-size').value);
            const aSize = parseInt(document.getElementById('student-settings-answer-font-size').value);
            
            let displayMode = 'single';
            const radios = document.getElementsByName('student-settings-display-mode');
            for (let r of radios) {
                if (r.checked) {
                    displayMode = r.value;
                    break;
                }
            }`;

const newStr = `        window.updateStudentSettings = function updateStudentSettings() {
            // First ensure modal elements exist to avoid classList errors on null elements
            const modal = document.getElementById('student-settings-modal');
            if (!modal) return;
            const qSize = parseInt(document.getElementById('student-settings-question-font-size').value);
            const aSize = parseInt(document.getElementById('student-settings-answer-font-size').value);
            
            let displayMode = 'single';
            const radios = document.getElementsByName('student-settings-display-mode');
            for (let r of radios) {
                if (r.checked) {
                    displayMode = r.value;
                    break;
                }
            }
            
            // Immediate CSS variable update for live preview
            document.querySelectorAll('.responsive-q-text').forEach(el => {
                el.style.setProperty('--base-q-size', \`\${qSize}px\`);
            });
            document.querySelectorAll('.responsive-a-text').forEach(el => {
                el.style.setProperty('--base-a-size', \`\${aSize}px\`);
            });`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched updateStudentSettings to apply CSS vars immediately!");
} else {
    console.log("Target not found!");
}
