const fs = require('fs');

// 1. Remove it from tab-exam.html
let tabContent = fs.readFileSync('public/components/tab-exam.html', 'utf8');
const modalStart = '<!-- Student Settings Modal -->';
if (tabContent.includes(modalStart)) {
    const parts = tabContent.split(modalStart);
    tabContent = parts[0];
    fs.writeFileSync('public/components/tab-exam.html', tabContent);
    console.log("Removed modal from tab-exam.html");
    
    // The modal code itself
    const modalCode = modalStart + parts[1];
    
    // 2. Append it to index.html
    let indexContent = fs.readFileSync('index.html', 'utf8');
    
    // Append it before </body> or inside the main app div
    const hook = '   <!-- Modal Container -->';
    if (indexContent.includes(hook)) {
        indexContent = indexContent.replace(hook, modalCode + '\n' + hook);
        fs.writeFileSync('index.html', indexContent);
        console.log("Injected modal into index.html");
    } else {
        console.log("Could not find hook in index.html");
    }
} else {
    console.log("Modal not found in tab-exam.html");
}
