const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Replace the toggleExamFullscreen function
const oldToggleStr = `        window.toggleExamFullscreen = function toggleExamFullscreen() {
            const elem = document.getElementById('exam-interface');
            if (!elem) return;
            
            if (!document.fullscreenElement) {
                if (elem.requestFullscreen) {
                    elem.requestFullscreen().catch(err => {
                        showToast(\`Lỗi không thể mở toàn màn hình: \${err.message}\`, 'error');
                    });
                } else if (elem.webkitRequestFullscreen) {
                    elem.webkitRequestFullscreen();
                } else if (elem.msRequestFullscreen) {
                    elem.msRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) {
                    document.msExitFullscreen();
                }
            }
        }`;

const newToggleStr = `        window.intentionalFullscreenExit = false;
        window.toggleExamFullscreen = function toggleExamFullscreen() {
            const elem = document.getElementById('exam-interface');
            if (!elem) return;
            
            if (!document.fullscreenElement) {
                const requestFs = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.msRequestFullscreen;
                if (requestFs) {
                    requestFs.call(elem).then(() => {
                        if (navigator.keyboard && navigator.keyboard.lock) {
                            navigator.keyboard.lock(['Escape']).catch(e => console.log('Keyboard lock failed', e));
                        }
                    }).catch(err => {
                        if(err) showToast(\`Lỗi không thể mở toàn màn hình: \${err.message || ''}\`, 'error');
                    });
                }
            } else {
                window.intentionalFullscreenExit = true;
                const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
                if (exitFs) {
                    if (navigator.keyboard && navigator.keyboard.unlock) {
                        navigator.keyboard.unlock();
                    }
                    exitFs.call(document).then(() => {
                        setTimeout(() => window.intentionalFullscreenExit = false, 500);
                    }).catch(err => {
                        setTimeout(() => window.intentionalFullscreenExit = false, 500);
                    });
                }
            }
        }`;

if (content.includes(oldToggleStr)) {
    content = content.replace(oldToggleStr, newToggleStr);
    console.log("Patched toggleExamFullscreen");
} else {
    console.log("Could not find toggleExamFullscreen");
}

// Inject keyboard listener near the end or at global scope
const keydownListener = `
        // --- Fullscreen Lock Anti-Cheat ---
        document.addEventListener('keydown', function (e) {
            const isExamActive = document.getElementById('exam-interface') && !document.getElementById('exam-interface').classList.contains('hidden');
            if (isExamActive && document.fullscreenElement) {
                // Block Esc (27), F11 (122), Windows Key, Alt, etc if desired.
                // We mainly block Esc and F11
                if (e.key === 'Escape' || e.key === 'F11' || e.keyCode === 27 || e.keyCode === 122) {
                    e.preventDefault();
                    e.stopPropagation();
                    showToast('🔒 Đã khóa! Vui lòng dùng nút "Thu nhỏ" để thoát toàn màn hình.', 'error');
                }
            }
        }, true);
`;

const contextmenuListener = `
        // Ngăn chặn chuột phải và các thao tác khác
        document.addEventListener('contextmenu', function (e) {
            const isExamActive = document.getElementById('exam-interface') && !document.getElementById('exam-interface').classList.contains('hidden');
            if (isExamActive && document.fullscreenElement) {
                e.preventDefault();
                showToast('🔒 Khóa chuột phải trong khi thi.', 'error');
            }
        }, true);
`;

// Now add the logic to catch unauthorized fullscreen exits in the 'fullscreenchange' event
const oldFullscreenChange = `        document.addEventListener('fullscreenchange', () => {
            const modalContainer = document.getElementById('modal-container');`;

const newFullscreenChange = `        document.addEventListener('fullscreenchange', () => {
            const isExamActive = document.getElementById('exam-interface') && !document.getElementById('exam-interface').classList.contains('hidden');
            if (isExamActive && !document.fullscreenElement && !window.intentionalFullscreenExit) {
                // Unauthorized exit from fullscreen
                window.handleCheatDetection('Thoát toàn màn hình trái phép');
                showConfirmModal('Bạn vừa thoát chế độ toàn màn hình không hợp lệ. Vui lòng quay lại toàn màn hình ngay lập tức để tiếp tục làm bài!', () => {
                    window.toggleExamFullscreen();
                }, '⚠️ CẢNH BÁO VI PHẠM', 'Quay lại toàn màn hình');
            }
            
            const modalContainer = document.getElementById('modal-container');`;

if (content.includes(oldFullscreenChange)) {
    content = content.replace(oldFullscreenChange, newFullscreenChange);
    console.log("Patched fullscreenchange event");
} else {
    console.log("Could not find fullscreenchange event");
}

// Inject event listeners at the end of window.onload or just global
const initMonitoringStr = `        window.initExamMonitoring = function initExamMonitoring() {
            window.updateCheatWarningUI();
            // Khuyến khích mở toàn màn hình khi bắt đầu nếu chưa mở
            if (!document.fullscreenElement && window.toggleExamFullscreen) {
                // Thử kích hoạt nếu trình duyệt cho phép từ tương tác người dùng
                try {
                    window.toggleExamFullscreen();
                } catch(e) {}
            }
        };`;

const newInitMonitoringStr = initMonitoringStr + '\n' + keydownListener + '\n' + contextmenuListener;

if (content.includes(initMonitoringStr)) {
    content = content.replace(initMonitoringStr, newInitMonitoringStr);
    console.log("Patched initExamMonitoring with global listeners");
} else {
    console.log("Could not find initExamMonitoring");
}

fs.writeFileSync('src/main.js', content);
