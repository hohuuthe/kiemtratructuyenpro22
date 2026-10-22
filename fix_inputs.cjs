const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');

content = content.replace(/id="student-settings-question-font-size" min="\d+" max="\d+"/g, 'id="student-settings-question-font-size" min="10" max="100"');
content = content.replace(/id="student-settings-answer-font-size" min="\d+" max="\d+"/g, 'id="student-settings-answer-font-size" min="10" max="100"');

fs.writeFileSync('index.html', content);
console.log("Patched index.html slider min/max");
