const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// The modal needs to be rendered INSIDE exam-interface for it to be visible in Fullscreen mode.
// Fullscreen mode only shows children of the element that requested it.
// So we need to append the student-settings-modal to 'exam-interface' OR
// when toggling, we temporarily move the modal into 'exam-interface'.

// Moving modal to exam-interface
const moveModalLogic = `
        window.openStudentSettingsModal = function() {
            const modal = document.getElementById('student-settings-modal');
            const examInterface = document.getElementById('exam-interface');
            if (modal && examInterface) {
                // If in fullscreen, ensure modal is a child of exam-interface so it's visible
                if (document.fullscreenElement) {
                    if (modal.parentElement !== examInterface) {
                        examInterface.appendChild(modal);
                    }
                } else {
                    // if not in fullscreen, it can be anywhere, but keep it in document.body
                    if (modal.parentElement !== document.body) {
                        document.body.appendChild(modal);
                    }
                }
                modal.classList.remove('hidden');
            }
        };
`;

const hookStr = `        window.toggleExamFullscreen = function toggleExamFullscreen() {`;
if (content.includes(hookStr) && !content.includes('openStudentSettingsModal')) {
    content = content.replace(hookStr, moveModalLogic + '\n' + hookStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched fullscreen open settings modal logic.");
} else {
    console.log("Hook not found or already patched.");
}
