const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const badStr = `                    if (!answerFound || !question.answer) {
                        if (answerFormat === 'red' && (type === '4-1' || type === 'TF4')) {
                            errors.push({
                                type: 'missing_answer',
                                line: startLine,
                                text: \`Câu \${questionNumber}\`,
                                message: \`Chế độ nhận diện chữ đỏ: Không tìm thấy đáp án đúng nào được bôi đỏ trong các lựa chọn A, B, C, D.\`
                            });
                        } else {
                            errors.push({
                                type: 'missing_answer',
                                line: startLine,
                                text: \`Câu \${questionNumber}\`,
                                message: \`Câu hỏi này thiếu dòng "Đáp án:". Bạn phải ghi rõ đáp án (ví dụ: Đáp án: A) để hệ thống nhận diện.\`
                            });
                        }
                    }

                    } else {
                        parsedQuestions.push(question);
                    }`;

const goodStr = `                    if (!answerFound || !question.answer) {
                        if (answerFormat === 'red' && (type === '4-1' || type === 'TF4')) {
                            errors.push({
                                type: 'missing_answer',
                                line: startLine,
                                text: \`Câu \${questionNumber}\`,
                                message: \`Chế độ nhận diện chữ đỏ: Không tìm thấy đáp án đúng nào được bôi đỏ trong các lựa chọn A, B, C, D.\`
                            });
                        } else {
                            errors.push({
                                type: 'missing_answer',
                                line: startLine,
                                text: \`Câu \${questionNumber}\`,
                                message: \`Câu hỏi này thiếu dòng "Đáp án:". Bạn phải ghi rõ đáp án (ví dụ: Đáp án: A) để hệ thống nhận diện.\`
                            });
                        }
                    } else {
                        parsedQuestions.push(question);
                    }`;

if (content.includes(badStr)) {
    content = content.replace(badStr, goodStr);
    console.log("Syntax fixed");
} else {
    console.log("Could not find badStr");
}

fs.writeFileSync('src/main.js', content);
