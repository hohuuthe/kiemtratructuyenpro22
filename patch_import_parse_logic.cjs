const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldDef = `        function parseQuestionsFromObjects(lines) {`;
const newDef = `        function parseQuestionsFromObjects(lines, answerFormat = 'default') {`;

if (content.includes(oldDef)) {
    content = content.replace(oldDef, newDef);
}

const oldOptionParse = `                    // Xử lý các lựa chọn cho 4-1 và TF4
                    if (type === '4-1' || type === 'TF4') {
                        const options = ['A', 'B', 'C', 'D'];
                        let foundOptions = 0;
                        for (const opt of options) {
                            if (i < lines.length) {
                                const optLine = lines[i];
                                const optMatch = optLine.text.trim().match(new RegExp(\`^\${opt}[\\\\.\\\\)\\\\:]\\\\s*(.*)\`, 'i'));
                                if (optMatch) {
                                    foundOptions++;
                                    let optText = optMatch[1].trim();
                                    let optImage = optLine.image;
                                    
                                    // Kiểm tra nếu dòng tiếp theo chỉ có ảnh cho lựa chọn này
                                    if (!optImage && i + 1 < lines.length && !lines[i+1].text && lines[i+1].image) {
                                        optImage = lines[i+1].image;
                                        i++;
                                    }
                                    
                                    i++;
                                    
                                    // Đọc tiếp các dòng nội dung lựa chọn
                                    while (i < lines.length) {
                                        const nextLineText = lines[i].text.trim();
                                        if (nextLineText.match(/^[A-F][.):]/i) || nextLineText.match(/^Đáp án\\s*[:.]?/i) || nextLineText.match(/^Câu\\s*\\d+[:.]?/i)) {
                                            break;
                                        }
                                        if (nextLineText || lines[i].image) {
                                            if (nextLineText) optText += '\\n' + nextLineText;
                                            if (!optImage && lines[i].image) optImage = lines[i].image;
                                        }
                                        i++;
                                    }
                                    question.options[opt] = { 
                                        text: optText || (optImage ? "(Xem hình anh)" : ""), 
                                        image: optImage 
                                    };
                                }
                            }
                        }
                        
                        if (foundOptions === 0) {
                            errors.push({
                                type: 'missing_options',
                                line: startLine,
                                text: \`Câu \${questionNumber}\`,
                                message: \`Câu hỏi loại \${type} nhưng không tìm thấy các lựa chọn A, B, C, D.\`
                            });
                        }
                    }

                    // Tìm đáp án
                    let answerFound = false;
                    while (i < lines.length) {
                        const answerMatch = lines[i].text.trim().match(/^Đáp án\\s*[:.]?\\s*(.*)/i);
                        if (answerMatch) {
                            answerFound = true;
                            let ans = answerMatch[1].trim();
                            let ansImage = '';

                            if (lines[i].image) {
                                ansImage = lines[i].image;
                            } else if (i + 1 < lines.length && !lines[i+1].text && lines[i+1].image) {
                                ansImage = lines[i+1].image;
                                i++;
                            }

                            if (type === '4-1') {
                                const charMatch = ans.match(/^[A-D]/i);
                                question.answer = charMatch ? charMatch[0].toUpperCase() : '';
                            } else if (type === 'TF4') {
                                question.answer = ans.toUpperCase();
                            } else {
                                question.answer = ans;
                            }

                            if (ansImage) {
                                if (!question.options) question.options = {};
                                question.options.answerImage = ansImage;
                            }
                            i++;
                            break;
                        }
                        
                        // Nếu gặp câu hỏi mới mà chưa thấy đáp án cho câu cũ
                        if (lines[i].text.match(/^Câu\\s*\\d+[:.]?/i)) {
                            break;
                        }
                        i++;
                    }

                    if (!answerFound || !question.answer) {
                        errors.push({
                            type: 'missing_answer',
                            line: startLine,
                            text: \`Câu \${questionNumber}\`,
                            message: \`Thiếu "Đáp án:" hoặc để trống đáp án. Nếu là câu hình ảnh, vui lòng ghi rõ "Đáp án: Ảnh"\`
                        });
                    }`;

const newOptionParse = `                    // Xử lý các lựa chọn cho 4-1 và TF4
                    let redOptionsFound = [];
                    if (type === '4-1' || type === 'TF4') {
                        const options = ['A', 'B', 'C', 'D'];
                        let foundOptions = 0;
                        for (const opt of options) {
                            if (i < lines.length) {
                                const optLine = lines[i];
                                const optMatch = optLine.text.trim().match(new RegExp(\`^\${opt}[\\\\.\\\\)\\\\:]\\\\s*(.*)\`, 'i'));
                                if (optMatch) {
                                    foundOptions++;
                                    let optText = optMatch[1].trim();
                                    let optImage = optLine.image;
                                    
                                    // Check if this option is red (answer mode 'red')
                                    if (answerFormat === 'red' && optLine.text.includes('<span class="red-text">')) {
                                        redOptionsFound.push(opt);
                                    }
                                    
                                    // Kiểm tra nếu dòng tiếp theo chỉ có ảnh cho lựa chọn này
                                    if (!optImage && i + 1 < lines.length && !lines[i+1].text && lines[i+1].image) {
                                        optImage = lines[i+1].image;
                                        i++;
                                    }
                                    
                                    i++;
                                    
                                    // Đọc tiếp các dòng nội dung lựa chọn
                                    while (i < lines.length) {
                                        const nextLineText = lines[i].text.trim();
                                        if (nextLineText.match(/^[A-F][.):]/i) || nextLineText.match(/^Đáp án\\s*[:.]?/i) || nextLineText.match(/^Câu\\s*\\d+[:.]?/i)) {
                                            break;
                                        }
                                        if (answerFormat === 'red' && nextLineText.includes('<span class="red-text">')) {
                                            if (!redOptionsFound.includes(opt)) redOptionsFound.push(opt);
                                        }
                                        if (nextLineText || lines[i].image) {
                                            if (nextLineText) optText += '\\n' + nextLineText;
                                            if (!optImage && lines[i].image) optImage = lines[i].image;
                                        }
                                        i++;
                                    }
                                    question.options[opt] = { 
                                        text: optText.replace(/<span class="red-text">/g, '').replace(/<\\/span>/g, '') || (optImage ? "(Xem hình anh)" : ""), 
                                        image: optImage 
                                    };
                                }
                            }
                        }
                        
                        if (foundOptions === 0) {
                            errors.push({
                                type: 'missing_options',
                                line: startLine,
                                text: \`Câu \${questionNumber}\`,
                                message: \`Câu hỏi loại \${type} nhưng không tìm thấy các lựa chọn A, B, C, D.\`
                            });
                        }
                    }

                    // Loại bỏ tag red-text khỏi nội dung câu hỏi
                    question.content = question.content.replace(/<span class="red-text">/g, '').replace(/<\\/span>/g, '');

                    // Tìm đáp án
                    let answerFound = false;
                    
                    if (answerFormat === 'red' && (type === '4-1' || type === 'TF4')) {
                        if (redOptionsFound.length > 0) {
                            answerFound = true;
                            if (type === '4-1') {
                                question.answer = redOptionsFound[0];
                            } else if (type === 'TF4') {
                                const tf4Answers = ['A', 'B', 'C', 'D'].map(o => redOptionsFound.includes(o) ? 'Đ' : 'S');
                                question.answer = tf4Answers.join(' ');
                            }
                        }
                    }
                    
                    while (i < lines.length) {
                        const answerMatch = lines[i].text.trim().match(/^Đáp án\\s*[:.]?\\s*(.*)/i);
                        if (answerMatch) {
                            answerFound = true;
                            let ans = answerMatch[1].trim();
                            let ansImage = '';

                            if (lines[i].image) {
                                ansImage = lines[i].image;
                            } else if (i + 1 < lines.length && !lines[i+1].text && lines[i+1].image) {
                                ansImage = lines[i+1].image;
                                i++;
                            }

                            // Chỉ ghi đè nếu format không phải red, hoặc (format red nhưng không tìm thấy redOptionsFound)
                            if (answerFormat !== 'red' || (answerFormat === 'red' && redOptionsFound.length === 0) || (type !== '4-1' && type !== 'TF4')) {
                                if (type === '4-1') {
                                    const charMatch = ans.match(/^[A-D]/i);
                                    question.answer = charMatch ? charMatch[0].toUpperCase() : '';
                                } else if (type === 'TF4') {
                                    question.answer = ans.toUpperCase();
                                } else {
                                    question.answer = ans;
                                }
                            }

                            if (ansImage) {
                                if (!question.options) question.options = {};
                                question.options.answerImage = ansImage;
                            }
                            i++;
                            break;
                        }
                        
                        // Nếu gặp câu hỏi mới mà chưa thấy đáp án cho câu cũ
                        if (lines[i].text.match(/^Câu\\s*\\d+[:.]?/i)) {
                            break;
                        }
                        i++;
                    }

                    if (!answerFound || !question.answer) {
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
                                message: \`Thiếu "Đáp án:" hoặc để trống đáp án. Nếu là câu hình ảnh, vui lòng ghi rõ "Đáp án: Ảnh"\`
                            });
                        }
                    }`;

if (content.includes(oldOptionParse)) {
    content = content.replace(oldOptionParse, newOptionParse);
    console.log("Patched parse logic");
} else {
    console.log("Could not find parse logic");
}

fs.writeFileSync('src/main.js', content);
