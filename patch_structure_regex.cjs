const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldQuestionMatch = `const questionMatch = text.match(/^Câu\\s*(\\d+)[:.]?\\s*\\[([^\\]]+)\\]\\s*\\[([^\\]]+)\\]\\s*\\[([^\\]]+)\\]\\s*(.*)/i);
                
                // Kiểm tra lỗi định dạng "Câu X" nhưng thiếu thông tin bổ trợ
                const easyMatch = text.match(/^Câu\\s*(\\d+)[:.]?\\s*(.*)/i);`;

const newQuestionMatch = `let structuralText = text.replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '').trim();
                
                // Regex linh hoạt hơn: cho phép khoảng trắng, dấu chấm/hai chấm
                const questionMatch = structuralText.match(/^Câu\\s*(\\d+)[:.]?\\s*\\[([^\\]]+)\\]\\s*\\[([^\\]]+)\\]\\s*\\[([^\\]]+)\\]\\s*(.*)/i);
                
                // Kiểm tra lỗi định dạng "Câu X" nhưng thiếu thông tin bổ trợ
                const easyMatch = structuralText.match(/^Câu\\s*(\\d+)[:.]?\\s*(.*)/i);`;

content = content.replace(oldQuestionMatch, newQuestionMatch);

const oldNextLineText = `const nextLineText = lines[i].text.trim();
                        if (nextLineText.match(/^(?:\\[\\[U\\]\\])?[A-F][.):]/i) || nextLineText.match(/^Đáp án\\s*[:.]?/i) || nextLineText.match(/^Câu\\s*\\d+[:.]?/i)) {`;

const newNextLineText = `const nextLineText = lines[i].text.trim();
                        let cleanNextLineText = nextLineText.replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '').trim();
                        if (cleanNextLineText.match(/^[A-F][.):]/i) || cleanNextLineText.match(/^Đáp án\\s*[:.]?/i) || cleanNextLineText.match(/^Câu\\s*\\d+[:.]?/i)) {`;

content = content.replace(oldNextLineText, newNextLineText);

const oldLineText1 = `let lineText = lines[i].text.trim();
                            if (lineText.match(/^Đáp án\\s*[:.]?/i) || lineText.match(/^Câu\\s*\\d+[:.]?/i)) {
                                break;
                            }`;

const newLineText1 = `let lineText = lines[i].text.trim();
                            let cleanStructuralLineText = lineText.replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '').trim();
                            if (cleanStructuralLineText.match(/^Đáp án\\s*[:.]?/i) || cleanStructuralLineText.match(/^Câu\\s*\\d+[:.]?/i)) {
                                break;
                            }`;

content = content.replace(oldLineText1, newLineText1);

const oldLineText2 = `const answerMatch = lines[i].text.trim().match(/^Đáp án\\s*[:.]?\\s*(.*)/i);`;
const newLineText2 = `let cleanAnsText = lines[i].text.trim().replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '').trim();
                        const answerMatch = cleanAnsText.match(/^Đáp án\\s*[:.]?\\s*(.*)/i);`;

content = content.replace(oldLineText2, newLineText2);

const oldLineText3 = `if (lines[i].text.match(/^Câu\\s*\\d+[:.]?/i)) {
                            break;
                        }`;
const newLineText3 = `if (lines[i].text.replace(/\\[\\[\\/?(?:U|B)\\]\\]/g, '').trim().match(/^Câu\\s*\\d+[:.]?/i)) {
                            break;
                        }`;
content = content.replace(oldLineText3, newLineText3);

const oldTextLower = `const textLower = text.toLowerCase();
                    if (textLower.startsWith('đáp án') || textLower.match(/^[a-d][.):]/)) {`;
const newTextLower = `const textLower = structuralText.toLowerCase();
                    if (textLower.startsWith('đáp án') || textLower.match(/^[a-d][.):]/)) {`;
content = content.replace(oldTextLower, newTextLower);


fs.writeFileSync('src/main.js', content);
console.log("Patched structural matching.");
