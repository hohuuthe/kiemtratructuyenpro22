const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const startIdx = content.indexOf('// Original code commented out below:');
if (startIdx !== -1) {
    // We want to delete up to the floating `  });`
    // Let's find the string "  // BẢO MẬT: API TÀI KHOẢN (ACCOUNTS)"
    const endMarker = '  // ==========================================';
    const endIdx = content.indexOf(endMarker, startIdx);
    if (endIdx !== -1) {
        content = content.slice(0, startIdx) + content.slice(endIdx);
        fs.writeFileSync('server.ts', content);
        console.log("Successfully removed floating block from server.ts");
    }
}
