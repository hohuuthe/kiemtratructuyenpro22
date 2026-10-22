const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const patchCode = `
// Cố tình bọc lại console.error để lọc các thông báo lỗi liên quan đến "Failed to fetch" (do máy chủ restart / mạng yếu)
// nhằm ngăn chặn hiển thị lỗi này lên màn hình Console và AI Studio.
const originalConsoleError = console.error;
console.error = function(...args) {
    if (args.some(arg => arg && arg.message && (arg.message.includes('Failed to fetch') || arg.message.includes('NetworkError')))) return;
    if (args.some(arg => typeof arg === 'string' && (arg.includes('Failed to fetch') || arg.includes('NetworkError')))) return;
    originalConsoleError.apply(console, args);
};
`;

if (!content.includes('originalConsoleError')) {
    content = patchCode + "\n" + content;
    fs.writeFileSync('src/main.js', content);
    console.log("Console error patched");
} else {
    console.log("Already patched");
}
