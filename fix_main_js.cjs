const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

content = content.replace(/console\.error\('Data loading failed:', err\);/g, `
if (err && err.message && err.message.includes('hạn mức')) {
    // quota error handled via UI
} else {
    console.error('Data loading failed:', err);
}`);

content = content.replace(/console\.error\('Error loading data:', e\);/g, `
if (e && e.message && e.message.includes('hạn mức')) {
    // quota error handled via UI
} else {
    console.error('Error loading data:', e);
}`);

fs.writeFileSync('src/main.js', content);
console.log("Done fixing main.js");
