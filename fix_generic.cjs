const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(/console\.error\(err\);/g, `if (err && err.message && err.message.includes("hạn mức dữ liệu")) {
        console.warn("API Error (Quota exceeded):", err.message);
        return res.status(503).json({ error: err.message });
      }
      console.error(err);`);

fs.writeFileSync('server.ts', content);
console.log("Done fixing generic errors");
