const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// globally revert
content = content.replace(/\[\[\/RED\]\]/g, '</span>');

// fix the JSZip textContent line
content = content.replace(/tNodes\[j\]\.textContent = "\[\[RED\]\]" \+ tNodes\[j\]\.textContent \+ "<\/span>"/, 'tNodes[j].textContent = "[[RED]]" + tNodes[j].textContent + "[[/RED]]"');

// check my regexes for remove red tag:
// question.content = question.content.replace(/\[\[RED\]\]/g, '').replace(/\[\[\/RED\]\]/g, ''); -> now it became replace(/<\/span>/g, '')
// Let's restore the regexes correctly:
content = content.replace(/replace\(\/\[\[RED\]\]\/g, ''\)\.replace\(\/<\/span>\/g, ''\)/g, "replace(/\\[\\[RED\\]\\]/g, '').replace(/\\[\\[\\/RED\\]\\]/g, '')");

fs.writeFileSync('src/main.js', content);
console.log("Reverted corrupted tags!");
