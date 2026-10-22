const fs = require('fs');

function patchHtml(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    
    // Remove the readonly hack and use autocomplete="off"
    content = content.split('autocomplete="nope" readonly onfocus="this.removeAttribute(\\\'readonly\\\')"').join('autocomplete="off"');
    content = content.split("autocomplete=\"nope\" readonly onfocus=\"this.removeAttribute('readonly')\"").join('autocomplete="off"');
    
    fs.writeFileSync(filepath, content);
}

patchHtml('public/components/tab-exam.html');
patchHtml('dist/components/tab-exam.html');

console.log("Reverted readonly hack.");
