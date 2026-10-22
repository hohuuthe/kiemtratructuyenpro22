const fs = require('fs');

function patchFile(filepath) {
    let content = fs.readFileSync(filepath, 'utf8');
    
    // Replace the autocomplete attribute and add some tricks
    // We'll replace autocomplete="new-password" with autocomplete="off" data-lpignore="true" data-form-type="other"
    content = content.replace(/id="hs-fullname" autocomplete="new-password"/g, 'id="hs-fullname" autocomplete="off" name="hs-fullname-ignore" data-lpignore="true" data-form-type="other"');
    content = content.replace(/id="hs-unit" autocomplete="new-password"/g, 'id="hs-unit" autocomplete="off" name="hs-unit-ignore" data-lpignore="true" data-form-type="other"');
    
    // Also patch exam password input
    content = content.replace(/id="exam-password-input" placeholder="Nhập mã bảo mật"/g, 'id="exam-password-input" placeholder="Nhập mã bảo mật" autocomplete="off" data-lpignore="true"');
    
    fs.writeFileSync(filepath, content);
}

patchFile('public/components/tab-exam.html');
if (fs.existsSync('dist/components/tab-exam.html')) {
    patchFile('dist/components/tab-exam.html');
}

let mainContent = fs.readFileSync('src/main.js', 'utf8');
mainContent = mainContent.replace(/<input type="password" id="exam-password-input" placeholder="Nhập mã bảo mật"/g, '<input type="password" id="exam-password-input" placeholder="Nhập mã bảo mật" autocomplete="off" data-lpignore="true"');
fs.writeFileSync('src/main.js', mainContent);

console.log("Patched HTML files.");
