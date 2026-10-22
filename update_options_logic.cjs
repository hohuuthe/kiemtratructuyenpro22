const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Replacements
content = content.replace(/\[\[RED\]\]/g, '[[U]]')
                 .replace(/\[\[\/RED\]\]/g, '[[/U]]')
                 .replace(/redOptionsFound/g, 'underlinedOptionsFound')
                 .replace(/answerFormat === 'red'/g, "answerFormat === 'underline'")
                 .replace(/Chế độ nhận diện chữ đỏ: Không tìm thấy đáp án đúng nào được bôi đỏ/g, 'Chế độ nhận diện GẠCH CHÂN: Không tìm thấy đáp án đúng nào được gạch chân');

fs.writeFileSync('src/main.js', content);
console.log("Updated options logic successfully.");
