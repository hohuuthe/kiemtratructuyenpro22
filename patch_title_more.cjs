const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldCheck2 = `                    if (appSettings.appTitle === "ỨNG DỤNG KIỂM TRA TRẮC NGHIỆM - PRO V1.0") {
                        appSettings.appTitle = "KIỂM TRA TRẮC NGHIỆM HHT PRO V1.0";
                    }
                    localStorage.setItem('appSettings', JSON.stringify(appSettings));`;

const newCheck2 = `                    if (appSettings.appTitle === "ỨNG DỤNG KIỂM TRA TRẮC NGHIỆM - PRO V1.0") {
                        appSettings.appTitle = "KIỂM TRA TRẮC NGHIỆM HHT PRO V1.0";
                    }
                    if (appSettings.appTitle === "Hệ Thống Khảo Sát & Đánh Giá Năng Lực Trực Tuyến" || appSettings.appTitle === "Hệ thống khảo sát & đánh giá năng lực trực tuyến" || appSettings.appTitle === "PHẦN MỀM KIỂM TRA TRẮC NGHIỆM") {
                        appSettings.appTitle = "HỆ THỐNG KIỂM TRA TRỰC TUYẾN";
                    }
                    localStorage.setItem('appSettings', JSON.stringify(appSettings));`;

content = content.replace(oldCheck2, newCheck2);

// And around line 2376:
const oldCheck3 = `                            appSlogan: sData.app_slogan || 'Sử dụng công nghệ AI chấm điểm tự luận',
                            logoUrl: sData.logo_url || ''
                        };
                    }`;

const newCheck3 = `                            appSlogan: sData.app_slogan || 'Sử dụng công nghệ AI chấm điểm tự luận',
                            logoUrl: sData.logo_url || ''
                        };
                        
                        if (appSettings.appTitle === "Hệ Thống Khảo Sát & Đánh Giá Năng Lực Trực Tuyến" || appSettings.appTitle === "Hệ thống khảo sát & đánh giá năng lực trực tuyến" || appSettings.appTitle === "PHẦN MỀM KIỂM TRA TRẮC NGHIỆM") {
                            appSettings.appTitle = "HỆ THỐNG KIỂM TRA TRỰC TUYẾN";
                        }
                    }`;

content = content.replace(oldCheck3, newCheck3);

fs.writeFileSync('src/main.js', content);
console.log("Patched more overrides");
