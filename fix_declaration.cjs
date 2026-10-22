const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const target = `            // Load display mode
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
    content = content.replace(target, '');
    fs.writeFileSync('src/main.js', content);
    console.log("Patched correctly!");
} else {
    console.log("Not found.");
}
