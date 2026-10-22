const fs = require('fs');

let mainContent = fs.readFileSync('src/main.js', 'utf8');

const backupStartStr = "                // BẢO MẬT & DỰ PHÒNG: Kiểm tra bài thi đang làm dở (Chống mất mạng/Sập nguồn)";
const backupEndStr = "                // Disable button to prevent double clicks";

let startIndex = mainContent.indexOf(backupStartStr);
let endIndex = mainContent.indexOf(backupEndStr, startIndex);

if (startIndex !== -1 && endIndex !== -1) {
    mainContent = mainContent.substring(0, startIndex) + mainContent.substring(endIndex);
    console.log("Successfully removed restore logic from startExam.");
} else {
    console.log("Failed to find restore logic block in startExam.");
}

const funcStartStr = "        window.backupExamState = function() {";
const funcEndStr = `            }
        };`;

let funcStartIndex = mainContent.indexOf(funcStartStr);
let funcEndIndex = mainContent.indexOf(funcEndStr, funcStartIndex);

if (funcStartIndex !== -1 && funcEndIndex !== -1) {
    mainContent = mainContent.substring(0, funcStartIndex) + "        window.backupExamState = function() {};" + mainContent.substring(funcEndIndex + funcEndStr.length);
    console.log("Successfully removed backupExamState logic.");
} else {
    console.log("Failed to find backupExamState block.");
}

fs.writeFileSync('src/main.js', mainContent);
