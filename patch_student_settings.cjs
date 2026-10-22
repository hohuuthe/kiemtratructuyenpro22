const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `        window.saveSettings = function saveSettings(showNotification = false) {`;

const newStr = `        window.updateStudentSettings = function updateStudentSettings() {
            const qSize = parseInt(document.getElementById('student-settings-question-font-size').value);
            const aSize = parseInt(document.getElementById('student-settings-answer-font-size').value);
            
            let displayMode = 'single';
            const radios = document.getElementsByName('student-settings-display-mode');
            for (let r of radios) {
                if (r.checked) {
                    displayMode = r.value;
                    break;
                }
            }
            
            appSettings.questionFontSize = qSize;
            appSettings.answerFontSize = aSize;
            appSettings.displayMode = displayMode;
            
            // Save to userPreferences
            let prefs = {};
            try {
                prefs = JSON.parse(localStorage.getItem('userPreferences')) || {};
            } catch (e) {}
            
            prefs.questionFontSize = qSize;
            prefs.answerFontSize = aSize;
            prefs.displayMode = displayMode;
            localStorage.setItem('userPreferences', JSON.stringify(prefs));
            
            if (currentExam && currentExam.id) {
                renderCurrentQuestion(true); // render with animation
            }
        };

        window.saveSettings = function saveSettings(showNotification = false) {`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched updateStudentSettings successfully!");
} else {
    console.log("Target not found!");
}
