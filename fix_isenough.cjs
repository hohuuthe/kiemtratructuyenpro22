const fs = require('fs');

let mainContent = fs.readFileSync('src/main.js', 'utf8');
mainContent = mainContent.replace(
    /isEnough = checkExamQuestionsAvailability\(examConfig, getCount\);/g,
    "let isEnough = checkExamQuestionsAvailability(examConfig, getCount);"
);

fs.writeFileSync('src/main.js', mainContent);
console.log("Fixed isEnough ReferenceError.");
