const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexReplaceBlock = /\/\/ Xử lý các lựa chọn cho 4-1 và TF4[\s\S]*?\/\/ Loại bỏ tag red-text khỏi nội dung câu hỏi/m;

const newBlock = `// Xử lý các lựa chọn cho 4-1 và TF4
                    let underlinedOptionsFound = [];
                    if (type === '4-1' || type === 'TF4') {
                        let currentOpt = null;
                        
                        while (i < lines.length) {
                            let lineText = lines[i].text.trim();
                            if (lineText.match(/^Đáp án\\s*[:.]?/i) || lineText.match(/^Câu\\s*\\d+[:.]?/i)) {
                                break;
                            }
                            
                            // Tối ưu 1: Văn bản bóng (Clean Text) - Xóa tag để Regex không bị mù do phân mảnh thẻ XML
                            let cleanText = lineText.replace(/\\[\\[\\/?U\\]\\]/g, '');
                            
                            // Tối ưu 2: Mở rộng Typo Tolerance (chấp nhận A . hoặc A ) )
                            const optRegex = /(?:^\\s*|\\t|\\s{2,})([A-D])\\s*[\\.\\)\\:]/gi;
                            let matches = [...cleanText.matchAll(optRegex)];
                            
                            if (matches.length > 0) {
                                // Nếu dùng cleanText, ta phải cẩn thận vì độ dài chuỗi gốc (có tag) sẽ khác.
                                // Giải pháp: Quét qua chuỗi gốc, loại bỏ các tag [[U]][[/U]] thừa (do Word phân mảnh) để đồng bộ.
                                let normalizedLineText = lineText.replace(/\\[\\[\\/U\\]\\]\\s*\\[\\[U\\]\\]/g, ''); 
                                
                                // Thay vì dùng index của cleanText gây lệch, ta cập nhật lại Regex để dò trực tiếp trên normalizedLineText
                                // Nhưng lần này cho phép các tag [[U]] kẹp ở bất cứ đâu giữa các ký tự
                                const robustOptRegex = /(?:^\\s*|\\t|\\s{2,}|\\[\\[U\\]\\])([A-D])(?:(?:\\[\\[\\/?U\\]\\])?\\s*)*(?:(?:\\[\\[\\/?U\\]\\])?)[\\.\\)\\:]/gi;
                                
                                let robustMatches = [...normalizedLineText.matchAll(robustOptRegex)];
                                
                                if (robustMatches.length > 0) {
                                    for (let m = 0; m < robustMatches.length; m++) {
                                        let optLetter = robustMatches[m][1].toUpperCase();
                                        let startIndex = robustMatches[m].index + robustMatches[m][0].length;
                                        let endIndex = (m + 1 < robustMatches.length) ? robustMatches[m + 1].index : normalizedLineText.length;
                                        
                                        let optText = normalizedLineText.substring(startIndex, endIndex).trim();
                                        let fullMatchStr = robustMatches[m][0];
                                        
                                        // Tối ưu 4: Kiểm tra Gạch chân (Underline Detection)
                                        let isUnderlined = fullMatchStr.includes('[[U]]') || optText.includes('[[U]]');
                                        
                                        if (!question.options[optLetter]) {
                                            question.options[optLetter] = { text: '', image: '' };
                                        }
                                        
                                        question.options[optLetter].text += (question.options[optLetter].text ? '\\n' : '') + optText;
                                        
                                        if (isUnderlined && answerFormat === 'underline') {
                                            if (!underlinedOptionsFound.includes(optLetter)) underlinedOptionsFound.push(optLetter);
                                        }
                                        currentOpt = optLetter;
                                    }
                                } else {
                                    // Fallback nếu có lỗi regex
                                    if (lineText) question.content += '\\n' + lineText;
                                }
                                
                                if (lines[i].image && currentOpt) {
                                    if (!question.options[currentOpt].image) {
                                        question.options[currentOpt].image = lines[i].image;
                                    }
                                }
                            } else if (currentOpt) {
                                // Tối ưu 3: Nối tiếp nội dung đa dòng (Multi-line option tracking)
                                if (answerFormat === 'underline' && lineText.includes('[[U]]')) {
                                    if (!underlinedOptionsFound.includes(currentOpt)) underlinedOptionsFound.push(currentOpt);
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
                                // Vẫn thuộc nội dung câu hỏi
                                if (lineText || lines[i].image) {
                                    if (lineText) question.content += '\\n' + lineText;
                                    if (!question.image && lines[i].image) question.image = lines[i].image;
                                }
                            }
                            i++;
                        }
                        
                        // Xóa tag [[U]] và đếm số lựa chọn
                        const optionsList = ['A', 'B', 'C', 'D'];
                        let foundOptions = 0;
                        for (const opt of optionsList) {
                            if (question.options[opt] && (question.options[opt].text || question.options[opt].image)) {
                                foundOptions++;
                                question.options[opt].text = question.options[opt].text.replace(/\\[\\[U\\]\\]/g, '').replace(/\\[\\[\\/U\\]\\]/g, '').trim();
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

                    // Loại bỏ tag red-text khỏi nội dung câu hỏi`;

if (regexReplaceBlock.test(content)) {
    content = content.replace(regexReplaceBlock, newBlock);
    fs.writeFileSync('src/main.js', content);
    console.log("Applied absolute parsing optimization.");
} else {
    console.log("Could not find block to replace.");
}
