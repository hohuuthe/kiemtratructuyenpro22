const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

content = content.replace(/optText\.replace\(\/\[\[RED\]\]\/g, ''\)\.replace\(\/<\/span>\/g, ''\)/g, "optText.replace(/\\[\\[RED\\]\\]/g, '').replace(/\\[\\[\\/RED\\]\\]/g, '')");
content = content.replace(/question\.content\.replace\(\/\[\[RED\]\]\/g, ''\)\.replace\(\/<\/span>\/g, ''\)/g, "question.content.replace(/\\[\\[RED\\]\\]/g, '').replace(/\\[\\[\\/RED\\]\\]/g, '')");

fs.writeFileSync('src/main.js', content);
