const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldCatch = `} catch (err) {
                if (err && err.message && err.message.includes("is not valid JSON")) {
    // Ignore HTML proxy errors from console
} else {
    console.error(err);
}
                showToast(err.message, 'error');
                examContainer.innerHTML = window.originalExamInterfaceHTML;
            }`;

const newCatch = `} catch (err) {
                let displayMsg = err.message || 'Lỗi không xác định';
                if (displayMsg === 'Failed to fetch' || displayMsg.includes('NetworkError')) {
                    displayMsg = 'Mất kết nối tới máy chủ. Vui lòng kiểm tra mạng và nhấn Nộp bài lại!';
                }
                
                if (err && err.message && err.message.includes("is not valid JSON")) {
                    // Ignore HTML proxy errors from console
                } else if (err.message !== 'Failed to fetch') {
                    console.error(err);
                }
                showToast(displayMsg, 'error');
                examContainer.innerHTML = window.originalExamInterfaceHTML;
            }`;

content = content.replace(oldCatch, newCatch);
fs.writeFileSync('src/main.js', content);
console.log("Submit error patched.");
