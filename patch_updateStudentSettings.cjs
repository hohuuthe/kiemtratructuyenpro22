const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `            if (currentExam && currentExam.id) {
                renderCurrentQuestion(true); // render with animation
            }`;

const newStr = `            if (currentExam && currentExam.questions && currentExam.questions.length > 0) {
                renderCurrentQuestion(false); // render without animation to avoid glitch
            }`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched currentExam condition in updateStudentSettings");
} else {
    console.log("Target not found!");
}
