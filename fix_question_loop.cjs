const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// The original condition:
// if (nextLineText.match(/^[A-F][.):]/i) || nextLineText.match(/^Đáp án\s*[:.]?/i) || nextLineText.match(/^Câu\s*\d+[:.]?/i)) {
// We need to change it to also match [[U]] at the beginning.

const oldCond = /if \(nextLineText\.match\(\/\^\[A-F\]\[\.\):\]\/i\) \|\| nextLineText\.match\(\/\^Đáp án\\s\*\[:\.\]\?\/i\) \|\| nextLineText\.match\(\/\^Câu\\s\*\\d\+\[:\.\]\?\/i\)\) \{/g;
const newCond = `if (nextLineText.match(/^(?:\\[\\[U\\]\\])?[A-F][.):]/i) || nextLineText.match(/^Đáp án\\s*[:.]?/i) || nextLineText.match(/^Câu\\s*\\d+[:.]?/i)) {`;

content = content.replace(oldCond, newCond);
fs.writeFileSync('src/main.js', content);
console.log("Fixed question loop breaking condition.");
