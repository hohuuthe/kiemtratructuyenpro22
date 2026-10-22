const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

content = content.replace(/answerFormat !== 'red'/g, "answerFormat !== 'underline'")
                 .replace(/format không phải red/g, "format không phải underline")
                 .replace(/format red nhưng/g, "format underline nhưng")
                 .replace(/replace\(\/\\\[\\\[RED\\\]\\\]\/g, ''\)/g, "replace(/\\[\\[U\\]\\]/g, '')")
                 .replace(/replace\(\/\\\[\\\[\\\/RED\\\]\\\]\/g, ''\)/g, "replace(/\\[\\[\\/U\\]\\]/g, '')");

// Since previous replacement might have missed the direct string `[[RED]]` because it was escaped in regex `replace(/\[\[RED\]\]/g, '')`, let's just do it directly.
content = content.replace(/\[\[RED\]\]/g, "[[U]]")
                 .replace(/\[\[\/RED\]\]/g, "[[/U]]");

fs.writeFileSync('src/main.js', content);
console.log("Updated options logic 2 successfully.");
