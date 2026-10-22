const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexReplaceBlock = /let underlinedOptionsFound = \[\];[\s\S]*?if \(!answerFound \|\| !question\.answer\) \{[\s\S]*?\} else \{/m;

const newBlock = `let markedOptionsFound = [];
                    if (type === '4-1' || type === 'TF4') {
                        let currentOpt = null;
                        
                        while (i < lines.length) {
                            let lineText = lines[i].text.trim();
                            if (lineText.match(/^Đáp án\\s*[:.]?/i) || lineText.match(/^Câu\\s*\\d+[:.]?/i)) {
                                break;
                            }
                            
                            let cleanText = lineText.replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '');
                            
                            const optRegex = /(?:^\\s*|\\t|\\s{2,})([A-D])\\s*[\\.\\)\\:]/gi;
                            let matches = [...cleanText.matchAll(optRegex)];
                            
                            if (matches.length > 0) {
                                let normalizedLineText = lineText.replace(/\\[\\[\\/(?:U|B)\\]\\]\\s*\\[\\[(?:U|B)\\]\\]/g, ''); 
                                
                                const robustOptRegex = /(?:^\\s*|\\t|\\s{2,}|\\[\\[(?:U|B)\\]\\])([A-D])(?:(?:\\[\\[\\/?(?:U|B)\\]\\])?\\s*)*(?:(?:\\[\\[\\/?(?:U|B)\\]\\])?)[\\.\\)\\:]/gi;
                                
                                let robustMatches = [...normalizedLineText.matchAll(robustOptRegex)];
                                
                                if (robustMatches.length > 0) {
                                    for (let m = 0; m < robustMatches.length; m++) {
                                        let optLetter = robustMatches[m][1].toUpperCase();
                                        let startIndex = robustMatches[m].index + robustMatches[m][0].length;
                                        let endIndex = (m + 1 < robustMatches.length) ? robustMatches[m + 1].index : normalizedLineText.length;
                                        
                                        let optText = normalizedLineText.substring(startIndex, endIndex).trim();
                                        let fullMatchStr = robustMatches[m][0];
                                        
                                        let isMarked = fullMatchStr.includes('[[U]]') || fullMatchStr.includes('[[B]]') || optText.includes('[[U]]') || optText.includes('[[B]]');
                                        
                                        if (!question.options[optLetter]) {
                                            question.options[optLetter] = { text: '', image: '' };
                                        }
                                        
                                        question.options[optLetter].text += (question.options[optLetter].text ? '\\n' : '') + optText;
                                        
                                        if (isMarked && (answerFormat === 'underline' || answerFormat === 'bold')) {
                                            if (!markedOptionsFound.includes(optLetter)) markedOptionsFound.push(optLetter);
                                        }
                                        currentOpt = optLetter;
                                    }
                                } else {
                                    if (lineText) question.content += '\\n' + lineText;
                                }
                                
                                if (lines[i].image && currentOpt) {
                                    if (!question.options[currentOpt].image) {
                                        question.options[currentOpt].image = lines[i].image;
                                    }
                                }
                            } else if (currentOpt) {
                                if ((answerFormat === 'underline' || answerFormat === 'bold') && (lineText.includes('[[U]]') || lineText.includes('[[B]]'))) {
                                    if (!markedOptionsFound.includes(currentOpt)) markedOptionsFound.push(currentOpt);
                                }
                                if (lineText || lines[i].image) {
                                    if (lineText) {
                                        question.options[currentOpt].text += (question.options[currentOpt].text ? '\\n' : '') + lineText;
                                    }
                                    if (!question.options[currentOpt].image && lines[i].image) {
                                        question.options[currentOpt].image = lines[i].image;
                                    }
                                }
                            } else {
                                if (lineText || lines[i].image) {
                                    if (lineText) question.content += '\\n' + lineText;
                                    if (!question.image && lines[i].image) question.image = lines[i].image;
                                }
                            }
                            i++;
                        }
                        
                        const optionsList = ['A', 'B', 'C', 'D'];
                        let foundOptions = 0;
                        for (const opt of optionsList) {
                            if (question.options[opt] && (question.options[opt].text || question.options[opt].image)) {
                                foundOptions++;
                                question.options[opt].text = question.options[opt].text.replace(/\\[\\[(?:U|B)\\]\\]/g, '').replace(/\\[\\[\\/(?:U|B)\\]\\]/g, '').trim();
                                if (!question.options[opt].text && question.options[opt].image) {
                                    question.options[opt].text = "(Xem hình ảnh)";
                                }
                            }
                        }
                        
                        if (foundOptions < 4 && type === '4-1') {
                            errors.push({
                                type: 'missing_options',
                                line: startLine,
                                text: \`Câu \${questionNumber}\`,
                                message: \`Câu hỏi Trắc nghiệm [4-1] nhưng chỉ tìm thấy \${foundOptions}/4 lựa chọn (A, B, C, D). Yêu cầu mỗi lựa chọn bắt đầu bằng A. B. C. D. và cách nhau rõ ràng.\`
                            });
                        } else if (foundOptions === 0 && type === 'TF4') {
                             errors.push({
                                type: 'missing_options',
                                line: startLine,
                                text: \`Câu \${questionNumber}\`,
                                message: \`Không tìm thấy lựa chọn nào cho câu hỏi loại \${type}.\`
                            });
                        }
                    }

                    question.content = question.content.replace(/\\[\\[(?:U|B)\\]\\]/g, '').replace(/\\[\\[\\/(?:U|B)\\]\\]/g, '');
                    
                    let answerFound = false;
                    
                    if ((answerFormat === 'underline' || answerFormat === 'bold') && (type === '4-1' || type === 'TF4')) {
                        if (markedOptionsFound.length > 0) {
                            answerFound = true;
                            if (type === '4-1') {
                                question.answer = markedOptionsFound[0];
                            } else if (type === 'TF4') {
                                const tf4Answers = ['A', 'B', 'C', 'D'].map(o => markedOptionsFound.includes(o) ? 'Đ' : 'S');
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
                            
                            if (answerFormat === 'default' || ((answerFormat === 'underline' || answerFormat === 'bold') && markedOptionsFound.length === 0) || (type !== '4-1' && type !== 'TF4')) {
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
                        
                        if (lines[i].text.match(/^Câu\\s*\\d+[:.]?/i)) {
                            break;
                        }
                        i++;
                    }
                    if (!answerFound || !question.answer) {
                        if ((answerFormat === 'underline' || answerFormat === 'bold') && (type === '4-1' || type === 'TF4')) {
                            const modeName = answerFormat === 'underline' ? 'GẠCH CHÂN' : 'IN ĐẬM';
                            errors.push({
                                type: 'missing_answer',
                                line: startLine,
                                text: \`Câu \${questionNumber}\`,
                                message: \`Chế độ nhận diện \${modeName}: Không tìm thấy đáp án đúng nào được đánh dấu trong các lựa chọn A, B, C, D.\`
                            });
                        } else {`;

if (regexReplaceBlock.test(content)) {
    content = content.replace(regexReplaceBlock, newBlock);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched options parsing logic.");
} else {
    console.log("Could not find regexReplaceBlock.");
}
