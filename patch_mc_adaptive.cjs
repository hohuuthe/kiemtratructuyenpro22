const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const targetStr = `            // Phân tích độ dài để chọn layout phù hợp
            let gridColsClass = 'grid-cols-1';
            if (!hasImage) {
                if (maxLen < 20) {
                    gridColsClass = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
                } else if (maxLen < 70) {
                    gridColsClass = 'grid-cols-1 sm:grid-cols-2';
                }
            }`;

const newStr = `            // Phân tích độ dài để chọn layout phù hợp
            let gridColsClass = 'grid-cols-1';
            if (!hasImage) {
                // Điều chỉnh không gian chiếm dụng theo cỡ chữ
                const currentFontSize = appSettings.answerFontSize || 20;
                // Nếu cỡ chữ lớn hơn mặc định (20px) thì không gian chiếm sẽ dài hơn.
                const visualLength = maxLen * (currentFontSize / 20);

                if (visualLength < 25) {
                    gridColsClass = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
                } else if (visualLength < 80) {
                    gridColsClass = 'grid-cols-1 sm:grid-cols-2';
                }
            }`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched renderMultipleChoice adaptive successfully!");
} else {
    console.log("Target not found!");
}
