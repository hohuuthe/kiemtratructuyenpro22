const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// The exact string in the code is:
// text: optText.replace(/[[RED]]/g, '').replace(/<\/span>/g, '') || (optImage ? "(Xem hình anh)" : ""), 

content = content.split("replace(/[[RED]]/g, '').replace(/<\\/span>/g, '')").join("replace(/\\[\\[RED\\]\\]/g, '').replace(/\\[\\[\\/RED\\]\\]/g, '')");

fs.writeFileSync('src/main.js', content);
