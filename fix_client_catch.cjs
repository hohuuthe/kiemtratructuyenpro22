const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

content = content.replace(/console\.error\(err\);/g, `
if (err && err.message && err.message.includes("is not valid JSON")) {
    // Ignore HTML proxy errors from console
} else {
    console.error(err);
}`);

content = content.replace(/console\.error\(e\);/g, `
if (e && e.message && e.message.includes("is not valid JSON")) {
    // Ignore HTML proxy errors from console
} else {
    console.error(e);
}`);

fs.writeFileSync('src/main.js', content);
console.log("Done");
