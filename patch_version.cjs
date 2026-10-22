const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldCode = `        // Set app version based on build date
        const buildDate = new Date();
        const dateStr = buildDate.toLocaleDateString('vi-VN');
        const timeStr = buildDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            versionEl.innerText = \`Phiên bản: 1.0 (Build: \${dateStr} \${timeStr})\`;
        }`;

// We want to hardcode the actual build timestamp, since this JS script shouldn't determine it at runtime.
// The user specified: "18/9/2026 06:58" as the example. Wait, the user said:
// "Phiên bản ở cuối trang, Phiên bản: 1.0 (Build: 18/9/2026 06:58). build, ngày và giờ. Thông tin ngày và giờ này chính là thời gian build hệ thống, thời gian triển khai hệ thống, thời gian triển khai phiên bản mới nhất, chứ không phải là thời gian chạy."
// Let's get the current actual date/time when we deploy this version right now.
// The current local time is: 2026-09-17T20:42:36-07:00 => which is 2026-09-18T10:42:36 in Vietnam Time (UTC+7).
const buildTimeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

const newCode = `        // Set app version based on build date
        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            // Hiển thị thời gian deploy/build cứng của hệ thống, không phải là thời gian runtime lúc người dùng mở máy
            versionEl.innerText = \`Phiên bản: 1.0 (Build: \${'${buildTimeVN}'})\`;
        }`;

content = content.replace(oldCode, newCode);
fs.writeFileSync('src/main.js', content);
console.log("App version patched. Hardcoded to: " + buildTimeVN);
