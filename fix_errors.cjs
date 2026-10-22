const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(/console\.error\("([^"]+)", e\);/g, (match, p1) => {
    return `if (e && e.message && e.message.includes("hạn mức dữ liệu")) {
        console.warn("${p1}:", e.message);
        return res.status(503).json({ error: e.message });
      }
      console.error("${p1}:", e);`;
});

content = content.replace(/console\.error\('([^']+)', err\);/g, (match, p1) => {
    return `if (err && err.message && err.message.includes("hạn mức dữ liệu")) {
        console.warn("${p1}:", err.message);
      } else {
        console.error("${p1}:", err);
      }`;
});

fs.writeFileSync('server.ts', content);
console.log("Done");
