const fs = require('fs');

const lines = [
    { text: "Câu 1: [BAI 1][NB][4-1] Nội dung câu hỏi", image: null },
    { text: "A. Đáp án A    B. Đáp án B", image: null },
    { text: "C. Đáp án C", image: null },
    { text: "D. Đáp án D", image: null },
    { text: "Đáp án: A", image: null },
    { text: "Câu 2: [BAI 1][NB][4-1] Câu 2", image: null },
    { text: "[[U]]A. Đúng[[/U]]", image: null },
    { text: "B. Sai", image: null },
    { text: "C. Sai    D. Sai", image: null },
];

let i = 0;
while (i < lines.length) {
    let text = lines[i].text.trim();
    const questionMatch = text.match(/^Câu\s*(\d+)[:.]?\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)/i);
    if (questionMatch) {
        console.log("Found:", questionMatch[1]);
        i++;
        let question = { options: {} };
        let underlinedOptionsFound = [];
        let currentOpt = null;
        let answerFormat = 'underline';
        
        while (i < lines.length) {
            let lineText = lines[i].text.trim();
            if (lineText.match(/^Đáp án\s*[:.]?/i) || lineText.match(/^Câu\s*\d+[:.]?/i)) {
                break;
            }
            
            const optRegex = /(?:^\s*|\t|\s{2,}|\[\[U\]\])([A-D])[\.\)\:]/gi;
            let matches = [...lineText.matchAll(optRegex)];
            
            if (matches.length > 0) {
                for (let m = 0; m < matches.length; m++) {
                    let optLetter = matches[m][1].toUpperCase();
                    let startIndex = matches[m].index + matches[m][0].length;
                    let endIndex = (m + 1 < matches.length) ? matches[m + 1].index : lineText.length;
                    
                    let optText = lineText.substring(startIndex, endIndex).trim();
                    let isUnderlined = matches[m][0].includes('[[U]]') || optText.includes('[[U]]');
                    
                    if (!question.options[optLetter]) question.options[optLetter] = { text: '', image: '' };
                    question.options[optLetter].text += (question.options[optLetter].text ? '\n' : '') + optText;
                    
                    if (isUnderlined && answerFormat === 'underline') {
                        if (!underlinedOptionsFound.includes(optLetter)) underlinedOptionsFound.push(optLetter);
                    }
                    currentOpt = optLetter;
                }
            }
            i++;
        }
        console.log(question.options);
        console.log("Underlined:", underlinedOptionsFound);
    } else {
        i++;
    }
}
