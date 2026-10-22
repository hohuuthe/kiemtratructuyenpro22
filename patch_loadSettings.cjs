const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// We need to add the radio button update logic to loadSettings()
// Let's find where loadSettings is defined and what it does.
// Around line 1734, after setting font sizes, it does:
//             const elADisplay = document.getElementById('display-answer-font-size');
//             if (elQInput) elQInput.value = qSize;
//             if (elQDisplay) elQDisplay.textContent = `${qSize}px`;
//             if (elAInput) elAInput.value = aSize;
//             if (elADisplay) elADisplay.textContent = `${aSize}px`;

const target = `            if (elAInput) elAInput.value = aSize;
            if (elADisplay) elADisplay.textContent = \`\${aSize}px\`;`;

const replacement = `            if (elAInput) elAInput.value = aSize;
            if (elADisplay) elADisplay.textContent = \`\${aSize}px\`;
            
            // Load display mode
            const displayMode = appSettings.displayMode || 'single';
            const displayModeRadios = document.getElementsByName('settings-display-mode');
            if (displayModeRadios && displayModeRadios.length > 0) {
                for (let radio of displayModeRadios) {
                    if (radio.value === displayMode) {
                        radio.checked = true;
                    } else {
                        radio.checked = false;
                    }
                }
            }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched loadSettings successfully!");
} else {
    console.log("Target not found!");
}
