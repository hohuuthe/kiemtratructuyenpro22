const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// The stray block starts at "// Mặc định thời gian sử dụng là 30 ngày kể từ ngày đăng ký"
// and ends before "function togglePasswordVisibility"

const startIndex = content.indexOf('// Mặc định thời gian sử dụng là 30 ngày kể từ ngày đăng ký');
const endIndex = content.indexOf('function togglePasswordVisibility(inputId, btn)');

if (startIndex !== -1 && endIndex !== -1) {
    // Delete everything in between, leaving the function toggle... intact
    const toDelete = content.substring(startIndex, endIndex);
    
    // BUT we need to see if there is any stray closing brace '}' that belongs to something else.
    // Actually, looking at the code, it's just the rest of the original `userRegister()` which had `try { ... } catch { ... } }`.
    // The closing brace before `function togglePasswordVisibility` is the closing brace for the original `userRegister()`.
    
    content = content.slice(0, startIndex) + content.slice(endIndex);
    fs.writeFileSync('src/main.js', content);
    console.log("Successfully removed stray block.");
} else {
    console.log("Could not find start or end index.");
}

