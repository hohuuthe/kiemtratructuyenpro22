const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Replace occurrences where we check for old string and add a check for the unwanted one.
const oldStringCheck = `                        if (appSettings.appTitle === "ỨNG DỤNG KIỂM TRA TRẮC NGHIỆM - PRO V1.0") {
                            appSettings.appTitle = "KIỂM TRA TRẮC NGHIỆM HHT PRO V1.0";
                        }`;

const newStringCheck = `                        if (appSettings.appTitle === "ỨNG DỤNG KIỂM TRA TRẮC NGHIỆM - PRO V1.0") {
                            appSettings.appTitle = "KIỂM TRA TRẮC NGHIỆM HHT PRO V1.0";
                        }
                        if (appSettings.appTitle === "Hệ Thống Khảo Sát & Đánh Giá Năng Lực Trực Tuyến" || appSettings.appTitle === "Hệ thống khảo sát & đánh giá năng lực trực tuyến" || appSettings.appTitle === "PHẦN MỀM KIỂM TRA TRẮC NGHIỆM") {
                            appSettings.appTitle = "HỆ THỐNG KIỂM TRA TRỰC TUYẾN";
                        }`;

content = content.replaceAll(oldStringCheck, newStringCheck);

// Let's also patch the Element SDK init part just in case
const oldElTitle = `                        const elTitle = document.getElementById('app-title');
                        if (elTitle) elTitle.textContent = config.app_title || defaultConfig.app_title;`;

const newElTitle = `                        const elTitle = document.getElementById('app-title');
                        let finalTitle = config.app_title || defaultConfig.app_title;
                        if (finalTitle === "Hệ Thống Khảo Sát & Đánh Giá Năng Lực Trực Tuyến" || finalTitle === "PHẦN MỀM KIỂM TRA TRẮC NGHIỆM") finalTitle = "HỆ THỐNG KIỂM TRA TRỰC TUYẾN";
                        if (elTitle) elTitle.textContent = finalTitle;`;

content = content.replace(oldElTitle, newElTitle);

fs.writeFileSync('src/main.js', content);
console.log("Patched src/main.js to forcibly remove bad title from cache/DB");
