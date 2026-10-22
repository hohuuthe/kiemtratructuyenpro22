const fs = require('fs');
const glob = require('fs').readdirSync;

function patchFile(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    
    // We only want to replace type="password" where id is not "login-password" (if it's in main.js)
    // Actually, let's just do a blanket replace for all occurrences in components/*.html
    if (filepath.includes('components/')) {
        content = content.replace(/type="password"/g, 'type="text" style="-webkit-text-security: disc;" autocomplete="off" data-lpignore="true"');
        fs.writeFileSync(filepath, content);
    }
}

const components = fs.readdirSync('public/components').filter(f => f.endsWith('.html'));
for (const file of components) {
    patchFile('public/components/' + file);
}

if (fs.existsSync('dist/components')) {
    const distComponents = fs.readdirSync('dist/components').filter(f => f.endsWith('.html'));
    for (const file of distComponents) {
        patchFile('dist/components/' + file);
    }
}

// In main.js, we have `change-confirm-password`, `backup-file-password`, `ai-api-key`.
let mainContent = fs.readFileSync('src/main.js', 'utf8');

mainContent = mainContent.replace(/<input type="password" id="change-confirm-password"/g, '<input type="text" id="change-confirm-password" style="-webkit-text-security: disc;" autocomplete="off" data-lpignore="true"');
mainContent = mainContent.replace(/<input type="password" id="backup-file-password"/g, '<input type="text" id="backup-file-password" style="-webkit-text-security: disc;" autocomplete="off" data-lpignore="true"');
mainContent = mainContent.replace(/<input type="password" id="ai-api-key"/g, '<input type="text" id="ai-api-key" style="-webkit-text-security: disc;" autocomplete="off" data-lpignore="true"');
mainContent = mainContent.replace(/<input type="password" id="change-old-password"/g, '<input type="text" id="change-old-password" style="-webkit-text-security: disc;" autocomplete="off" data-lpignore="true"');
mainContent = mainContent.replace(/<input type="password" id="change-new-password"/g, '<input type="text" id="change-new-password" style="-webkit-text-security: disc;" autocomplete="off" data-lpignore="true"');

fs.writeFileSync('src/main.js', mainContent);
console.log("Patched all remaining static password fields to text with disc security.");
