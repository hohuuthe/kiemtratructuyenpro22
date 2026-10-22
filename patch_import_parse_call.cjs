const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldStr = `                elements.forEach(el => processElement(el));

                updateProgress('Đang phân tích cấu trúc câu hỏi & đối soát định dạng...', 85);
                await new Promise(resolve => setTimeout(resolve, 200));

                const { questions: parsedQuestions, errors } = parseQuestionsFromObjects(lines);`;

const newStr = `                elements.forEach(el => processElement(el));

                updateProgress('Đang phân tích cấu trúc câu hỏi & đối soát định dạng...', 85);
                await new Promise(resolve => setTimeout(resolve, 200));

                const { questions: parsedQuestions, errors } = parseQuestionsFromObjects(lines, answerFormat);`;

if (content.includes(oldStr)) {
    content = content.replace(oldStr, newStr);
    console.log("Patched parseQuestionsFromObjects call");
} else {
    console.log("Could not find parseQuestionsFromObjects call");
}

fs.writeFileSync('src/main.js', content);
