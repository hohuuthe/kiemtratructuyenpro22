const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `            // Load Display Mode
            const displayMode = appSettings.displayMode || 'single';
            const displayModeRadios = document.getElementsByName('settings-display-mode');
            for (let radio of displayModeRadios) {
                if (radio.value === displayMode) {
                    radio.checked = true;
                }
            }`;

const newStr = `            // Load Display Mode
            const displayMode = appSettings.displayMode || 'single';
            const displayModeRadios = document.getElementsByName('settings-display-mode');
            for (let radio of displayModeRadios) {
                if (radio.value === displayMode) {
                    radio.checked = true;
                }
            }
            
            // Sync to student settings modal
            const stQInput = document.getElementById('student-settings-question-font-size');
            const stQDisplay = document.getElementById('student-display-question-font-size');
            const stAInput = document.getElementById('student-settings-answer-font-size');
            const stADisplay = document.getElementById('student-display-answer-font-size');
            
            if (stQInput) stQInput.value = qSize;
            if (stQDisplay) stQDisplay.textContent = \`\${qSize}px\`;
            if (stAInput) stAInput.value = aSize;
            if (stADisplay) stADisplay.textContent = \`\${aSize}px\`;
            
            const stModeRadios = document.getElementsByName('student-settings-display-mode');
            if (stModeRadios) {
                for (let radio of stModeRadios) {
                    if (radio.value === displayMode) {
                        radio.checked = true;
                    }
                }
            }`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched loadSettings for student modal successfully!");
} else {
    console.log("Target not found!");
}
