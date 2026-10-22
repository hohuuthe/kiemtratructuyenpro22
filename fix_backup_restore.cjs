const fs = require('fs');

let mainContent = fs.readFileSync('src/main.js', 'utf8');

const backupLogicBlockStart = `                // BẢO MẬT & DỰ PHÒNG: Kiểm tra bài thi đang làm dở (Chống mất mạng/Sập nguồn)`;
const backupLogicBlockEnd = `                // Disable button to prevent double clicks
                if (startBtn) {`;

const backupBlockRegex = new RegExp(backupLogicBlockStart.replace(/[.*+?^$\/{}()|[\\]\\\\]/g, '\\\\$&') + '[\\\\s\\\\S]*?' + backupLogicBlockEnd.replace(/[.*+?^$\/{}()|[\\]\\\\]/g, '\\\\$&'));

if (mainContent.match(backupBlockRegex)) {
    mainContent = mainContent.replace(backupBlockRegex, `                // Disable button to prevent double clicks
                if (startBtn) {`);
    console.log("Successfully removed restore logic from startExam.");
} else {
    console.log("Failed to find restore logic block in startExam.");
}

const backupFuncStart = `        window.backupExamState = function() {`;
const backupFuncEnd = `            }
        };`;
const funcBlockRegex = new RegExp(backupFuncStart.replace(/[.*+?^$\/{}()|[\\]\\\\]/g, '\\\\$&') + '[\\\\s\\\\S]*?' + backupFuncEnd.replace(/[.*+?^$\/{}()|[\\]\\\\]/g, '\\\\$&'));

if (mainContent.match(funcBlockRegex)) {
    mainContent = mainContent.replace(funcBlockRegex, `        window.backupExamState = function() {};`);
    console.log("Successfully removed backupExamState logic.");
} else {
    console.log("Failed to find backupExamState block.");
}

fs.writeFileSync('src/main.js', mainContent);
