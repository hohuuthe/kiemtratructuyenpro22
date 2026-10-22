const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `        window.updateStudentSettings = function updateStudentSettings() {`;

const newStr = `        window.updateStudentSettings = function updateStudentSettings() {
            // First ensure modal elements exist to avoid classList errors on null elements
            const modal = document.getElementById('student-settings-modal');
            if (!modal) return;`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched updateStudentSettings with safety check");
} else {
    console.log("Target not found!");
}
