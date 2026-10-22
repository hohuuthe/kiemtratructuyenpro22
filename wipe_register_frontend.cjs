const fs = require('fs');
let mainContent = fs.readFileSync('src/main.js', 'utf8');

// Replace showRegisterModal entirely
mainContent = mainContent.replace(
    /window\.showRegisterModal = function showRegisterModal\(\) \{[\s\S]*?\}\s*async function userRegister\(\) \{[\s\S]*?\n\s*\}/,
    `window.showRegisterModal = function showRegisterModal() {
            showToast('Tính năng đăng ký đã bị khóa tuyệt đối. Chỉ Admin mới có quyền tạo tài khoản.', 'error');
            return;
        }

        async function userRegister() {
            showToast('Tính năng đăng ký đã bị khóa tuyệt đối. Chỉ Admin mới có quyền tạo tài khoản.', 'error');
            return;
        }`
);

fs.writeFileSync('src/main.js', mainContent);
console.log("Done wiping register frontend.");
