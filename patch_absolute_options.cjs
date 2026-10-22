const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexReplaceBlock = /let markedOptionsFound = \[\];[\s\S]*?if \(!answerFound \|\| !question\.answer\) \{/m;

const newBlock = `// --- THUẬT TOÁN NHẬN DIỆN TRỌNG SỐ TỐI ƯU ---
                    let markedStatus = { A: { prefix: false, content: false }, B: { prefix: false, content: false }, C: { prefix: false, content: false }, D: { prefix: false, content: false } };
                    let markedOptionsFound = [];
                    const activeTag = answerFormat === 'underline' ? '[[U]]' : '[[B]]';
                    
                    if (type === '4-1' || type === 'TF4') {
                        let currentOpt = null;
                        
                        while (i < lines.length) {
                            let lineText = lines[i].text.trim();
                            
                            // Lọc nhiễu trước khi check cấu trúc (Fix: Bold câu X)
                            let cleanStructuralLineText = lineText.replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '').trim();
                            if (cleanStructuralLineText.match(/^Đáp án\\s*[:.]?/i) || cleanStructuralLineText.match(/^Câu\\s*\\d+[:.]?/i)) {
                                break;
                            }
                            
                            let cleanText = lineText.replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '');
                            
                            const optRegex = /(?:^\\s*|\\t|\\s{2,})([A-D])\\s*[\\.\\)\\:]/gi;
                            let matches = [...cleanText.matchAll(optRegex)];
                            
                            if (matches.length > 0) {
                                let normalizedLineText = lineText.replace(/\\[\\[\\/(?:U|B)\\]\\]\\s*\\[\\[(?:U|B)\\]\\]/g, ''); 
                                
                                // Fix Góc khuất 3: Chấp nhận vô hạn thẻ kép ở đầu dòng
                                const robustOptRegex = /(?:^\\s*|\\t|\\s{2,}|(?:\\[\\[\\/?(?:U|B)\\]\\]\\s*)+)([A-D])(?:(?:\\[\\[\\/?(?:U|B)\\]\\])?\\s*)*(?:(?:\\[\\[\\/?(?:U|B)\\]\\])?)[\\.\\)\\:]/gi;
                                
                                let robustMatches = [...normalizedLineText.matchAll(robustOptRegex)];
                                
                                if (robustMatches.length > 0) {
                                    for (let m = 0; m < robustMatches.length; m++) {
                                        let optLetter = robustMatches[m][1].toUpperCase();
                                        let startIndex = robustMatches[m].index + robustMatches[m][0].length;
                                        let endIndex = (m + 1 < robustMatches.length) ? robustMatches[m + 1].index : normalizedLineText.length;
                                        
                                        let optText = normalizedLineText.substring(startIndex, endIndex).trim();
                                        let fullMatchStr = robustMatches[m][0];
                                        
                                        // Phân tách Trọng số: Tiền tố vs Nội dung
                                        let isPrefixMarked = fullMatchStr.includes(activeTag);
                                        let isContentMarked = optText.includes(activeTag);
                                        
                                        if (!question.options[optLetter]) {
                                            question.options[optLetter] = { text: '', image: '' };
                                        }
                                        
                                        if (markedStatus[optLetter]) {
                                            if (isPrefixMarked) markedStatus[optLetter].prefix = true;
                                            if (isContentMarked) markedStatus[optLetter].content = true;
                                        }
                                        
                                        question.options[optLetter].text += (question.options[optLetter].text ? '\\n' : '') + optText;
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
                                // Xử lý dòng nối tiếp của một đáp án
                                if ((answerFormat === 'underline' || answerFormat === 'bold') && lineText.includes(activeTag)) {
                                    if (markedStatus[currentOpt]) markedStatus[currentOpt].content = true;
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
                        
                        // Đánh giá Trọng số Đáp án
                        let strongCandidates = [];
                        let weakCandidates = [];
                        
                        for (const opt of ['A', 'B', 'C', 'D']) {
                            if (markedStatus[opt].content) strongCandidates.push(opt);
                            else if (markedStatus[opt].prefix) weakCandidates.push(opt);
                        }
                        
                        // Nếu có ứng viên mạnh (nội dung được in đậm/gạch chân), bỏ qua hoàn toàn ứng viên yếu
                        if (strongCandidates.length > 0) {
                            markedOptionsFound = strongCandidates;
                        } 
                        // Nếu không có ứng viên mạnh, nhưng chỉ có ĐÚNG 1 ứng viên yếu (chỉ in đậm tiền tố 1 đáp án duy nhất)
                        else if (weakCandidates.length === 1) {
                            markedOptionsFound = weakCandidates;
                        }
                        // Nếu weakCandidates > 1 (Trang trí A, B, C, D đều in đậm) -> Không xem là đáp án. markedOptionsFound = []
                        
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
                            // Cảnh báo False-Positive: Nếu có nhiều hơn 1 đáp án trong câu 4-1
                            if (type === '4-1' && markedOptionsFound.length > 1) {
                                const modeName = answerFormat === 'underline' ? 'gạch chân' : 'in đậm';
                                errors.push({
                                    type: 'ambiguous_answer',
                                    line: startLine,
                                    text: \`Câu \${questionNumber}\`,
                                    message: \`Lỗi nhận diện \${modeName}: Có nhiều hơn 1 đáp án được đánh dấu (\${markedOptionsFound.join(', ')}). Vui lòng kiểm tra lại xem bạn có lỡ tay \${modeName} từ khóa trong đáp án sai hay không.\`
                                });
                            } else {
                                answerFound = true;
                                if (type === '4-1') {
                                    question.answer = markedOptionsFound[0];
                                } else if (type === 'TF4') {
                                    const tf4Answers = ['A', 'B', 'C', 'D'].map(o => markedOptionsFound.includes(o) ? 'Đ' : 'S');
                                    question.answer = tf4Answers.join(' ');
                                }
                            }
                        }
                    }
                    
                    while (i < lines.length) {
                        let cleanAnsText = lines[i].text.trim().replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '').trim();
                        const answerMatch = cleanAnsText.match(/^Đáp án\\s*[:.]?\\s*(.*)/i);
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
                        
                        if (lines[i].text.replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '').trim().match(/^Câu\\s*\\d+[:.]?/i)) {
                            break;
                        }
                        i++;
                    }
                    if (!answerFound || !question.answer) {`;

if (regexReplaceBlock.test(content)) {
    content = content.replace(regexReplaceBlock, newBlock);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched absolute weighted logic.");
} else {
    console.log("Could not find regexReplaceBlock.");
}
