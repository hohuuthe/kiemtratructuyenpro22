const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `            appSettings.questionFontSize = qSize;
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
            
            if (currentExam && currentExam.questions && currentExam.questions.length > 0) {
                renderCurrentQuestion(false); // render without animation to avoid glitch
            }`;

const newStr = `            const modeChanged = appSettings.displayMode !== displayMode;
            
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
            
            if (currentExam && currentExam.questions && currentExam.questions.length > 0) {
                if (modeChanged) {
                    renderCurrentQuestion(false); 
                }
            }`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched updateStudentSettings with modeChanged check");
} else {
    console.log("Target not found!");
}
