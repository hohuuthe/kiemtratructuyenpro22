const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `        function renderMultipleChoice(q, index) {
            const options = q.shuffledOptions || ['A', 'B', 'C', 'D'];
            const selectedAnswer = currentExam.answers[index];
            return \`<div class="grid grid-cols-1 gap-1.5 w-full">
                \${options.map((opt, i) => {`;

const newStr = `        function renderMultipleChoice(q, index) {
            const options = q.shuffledOptions || ['A', 'B', 'C', 'D'];
            const selectedAnswer = currentExam.answers[index];
            
            let hasImage = false;
            let maxLen = 0;
            options.forEach(opt => {
                const optionData = (q.options && q.options[opt]) ? q.options[opt] : { text: '', image: '' };
                if (optionData.image) hasImage = true;
                // Lọc bỏ HTML tags và đếm độ dài văn bản thô
                const textLen = (optionData.text || '').replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ').length;
                if (textLen > maxLen) maxLen = textLen;
            });
            
            // Phân tích độ dài để chọn layout phù hợp
            let gridColsClass = 'grid-cols-1';
            if (!hasImage) {
                if (maxLen < 20) {
                    gridColsClass = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
                } else if (maxLen < 70) {
                    gridColsClass = 'grid-cols-1 sm:grid-cols-2';
                }
            }

            return \`<div class="grid \${gridColsClass} gap-2 w-full">
                \${options.map((opt, i) => {`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched renderMultipleChoice successfully!");
} else {
    console.log("Target not found!");
}
