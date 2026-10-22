const fs = require('fs');
let content = fs.readFileSync('public/components/tab-exam.html', 'utf8');

const targetStr = `onclick="document.getElementById('student-settings-modal').classList.remove('hidden')"`;
const newStr = `onclick="openStudentSettingsModal()"`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('public/components/tab-exam.html', content);
    console.log("Patched tab-exam.html settings btn");
} else {
    console.log("Target not found!");
}
