const fs = require('fs');
let serverContent = fs.readFileSync('server.ts', 'utf8');

// Replace the inside of /api/auth/register to immediately return 403
serverContent = serverContent.replace(
    /app\.post\("\/api\/auth\/register", async \(req, res\) => {[\s\S]*?const validAudiences = \['Học sinh', 'Giáo viên', 'Khác'\];/m,
    `app.post("/api/auth/register", async (req, res) => {
    return res.status(403).json({ error: "Cơ chế tự đăng ký tài khoản đã bị khóa để ngăn chặn tạo tài khoản ảo. Vui lòng liên hệ Admin để được cấp phép." });
    
    // Original code commented out below:
    try {
      const { username, password, full_name, donvi, target_audience, phone_number, expiry_date, gender, dob, address, occupation, payment_status, payment_method } = req.body;
      if (!username || !password || !full_name || !target_audience || !donvi) {
         return res.status(400).json({ error: "Thiếu các trường bắt buộc." });
      }
      const validAudiences = ['Học sinh', 'Giáo viên', 'Khác'];`
);

fs.writeFileSync('server.ts', serverContent);

let mainContent = fs.readFileSync('src/main.js', 'utf8');

mainContent = mainContent.replace(
    /async function userRegister\(\) \{/,
    `async function userRegister() {
            showToast('Tính năng tự đăng ký đã bị khóa để ngăn chặn tài khoản ảo. Vui lòng liên hệ Admin.', 'error');
            return;
`
);

// Remove or hide the register button
mainContent = mainContent.replace(
    /<button type="button" onclick="closeModal\(\); showRegisterModal\(\)" class="text-purple-600 hover:text-purple-800 text-sm font-semibold">Đăng ký tài khoản<\/button>/,
    `<!-- Cơ chế đăng ký tự do đã bị khóa -->`
);

fs.writeFileSync('src/main.js', mainContent);

console.log("Done locking register mechanism.");
