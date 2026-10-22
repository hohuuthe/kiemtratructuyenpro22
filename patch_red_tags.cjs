const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Replace the span matching in extractTextWithSupSub (we don't strictly need it if Mammoth outputs plain text, but good to clean up)
content = content.replace(/\} else if \(tagName === 'span' && child\.classList\.contains\('red-text'\)\) \{\s*result \+= `<span class="red-text">\$\{extractTextWithSupSub\(child\)\}<\/span>`;/, "");

// Replace the RedText style mapping (also optional to remove, but cleaner)
content = content.replace(/"r\[style-name='RedText'\] => span\.red-text"/, "");

// In parseQuestionsFromObjects
content = content.replace(/<span class="red-text">/g, "[[RED]]");
content = content.replace(/<\/span>/g, "[[/RED]]");

fs.writeFileSync('src/main.js', content);
console.log("Patched red tags successfully");
