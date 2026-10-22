const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `        function initProtectedTabs() {
            // Nếu người dùng ở các tab bảo mật, mở chúng
            const currentActiveTab = document.querySelector('.tab-content.active');
            if (currentActiveTab.id === 'tab-questions' && !document.getElementById('questions-panel').classList.contains('hidden')) {
                return; // Đã mở
            }
            if (currentActiveTab.id === 'tab-exams' && !document.getElementById('exams-panel').classList.contains('hidden')) {
                return;
            }
            if (currentActiveTab.id === 'tab-settings' && !document.getElementById('settings-panel').classList.contains('hidden')) {
                return;
            }
        }`;

const newStr = `        function initProtectedTabs() {
            // Nếu người dùng ở các tab bảo mật, mở chúng
            const currentActiveTab = document.querySelector('.tab-content.active');
            if (!currentActiveTab) return;
            
            if (currentActiveTab.id === 'tab-questions') {
                const p = document.getElementById('questions-panel');
                if (p && !p.classList.contains('hidden')) return;
            }
            if (currentActiveTab.id === 'tab-exams') {
                const p = document.getElementById('exams-panel');
                if (p && !p.classList.contains('hidden')) return;
            }
            if (currentActiveTab.id === 'tab-settings') {
                const p = document.getElementById('settings-panel');
                if (p && !p.classList.contains('hidden')) return;
            }
        }`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched initProtectedTabs successfully!");
} else {
    console.log("Target not found!");
}
