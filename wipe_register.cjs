const fs = require('fs');
let serverContent = fs.readFileSync('server.ts', 'utf8');

// Replace the entire register endpoint block up to the catch block
const regex = /app\.post\("\/api\/auth\/register", async \(req, res\) => \{[\s\S]*?\}\);/m;
const replacement = `app.post("/api/auth/register", async (req, res) => {
    return res.status(403).json({ error: "Cơ chế tự đăng ký tài khoản đã bị khóa tuyệt đối. Chỉ Admin mới có quyền tạo tài khoản." });
  });`;

serverContent = serverContent.replace(regex, replacement);
fs.writeFileSync('server.ts', serverContent);
console.log("Done wiping register endpoint.");
