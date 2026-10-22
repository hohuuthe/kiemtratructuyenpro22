const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexReplace = /const isRed = \(v\) => \{[\s\S]*?const serializer = new XMLSerializer\(\);/m;

const newLogic = `const isRed = (v) => {
                                if (!v) return false;
                                v = v.toUpperCase();
                                if (v === 'RED' || v === 'FF0000' || v === 'C00000' || v === 'E53935' || v === 'D32F2F') return true;
                                if (/^[0-9A-F]{6}$/.test(v)) {
                                    const r = parseInt(v.substring(0,2), 16);
                                    const g = parseInt(v.substring(2,4), 16);
                                    const b = parseInt(v.substring(4,6), 16);
                                    // Thuật toán nhận diện ĐỎ bao dung hơn:
                                    // Màu có sắc tố Đỏ (R) lớn hơn 100, và R phải lớn hơn G và B một khoảng an toàn
                                    if (r > 100 && r > (g + 20) && r > (b + 20)) return true;
                                }
                                return false;
                            };

                            const isHighlightRed = (v) => {
                                if (!v) return false;
                                v = v.toLowerCase();
                                return ['red', 'magenta', 'darkred', 'darkmagenta', 'pink'].includes(v);
                            };

                            // Quét theo cấp đoạn văn (Paragraph) trước để tránh sót
                            const paragraphs = xmlDoc.getElementsByTagName("w:p");
                            for (let p = 0; p < paragraphs.length; p++) {
                                const para = paragraphs[p];
                                let pIsRed = false;

                                // Kiểm tra thuộc tính của đoạn văn (Paragraph Properties)
                                const pPrs = para.getElementsByTagName("w:pPr");
                                if (pPrs.length > 0) {
                                    const pPrColors = pPrs[0].getElementsByTagName("w:color");
                                    for(let c=0; c<pPrColors.length; c++) {
                                        if(isRed(pPrColors[c].getAttribute("w:val"))) pIsRed = true;
                                    }
                                    const pPrHis = pPrs[0].getElementsByTagName("w:highlight");
                                    for(let h=0; h<pPrHis.length; h++) {
                                        if(isHighlightRed(pPrHis[h].getAttribute("w:val"))) pIsRed = true;
                                    }
                                }

                                const runs = para.getElementsByTagName("w:r");
                                for (let i = 0; i < runs.length; i++) {
                                    const run = runs[i];
                                    let runIsRed = pIsRed; // Kế thừa từ đoạn văn

                                    if (!runIsRed) {
                                        const colorNodes = run.getElementsByTagName("w:color");
                                        for(let c=0; c<colorNodes.length; c++) {
                                            if (isRed(colorNodes[c].getAttribute("w:val"))) runIsRed = true;
                                        }
                                        
                                        const highlightNodes = run.getElementsByTagName("w:highlight");
                                        for(let h=0; h<highlightNodes.length; h++) {
                                            if (isHighlightRed(highlightNodes[h].getAttribute("w:val"))) runIsRed = true;
                                        }
                                    }
                                    
                                    if (runIsRed) {
                                        const tNodes = run.getElementsByTagName("w:t");
                                        for (let j = 0; j < tNodes.length; j++) {
                                            if (tNodes[j].textContent && tNodes[j].textContent.trim().length > 0) {
                                                // Bọc keyword RED vào để Mammoth phân tách
                                                tNodes[j].textContent = "[[RED]]" + tNodes[j].textContent + "[[/RED]]";
                                            }
                                        }
                                    }
                                }
                            }
                            
                            const serializer = new XMLSerializer();`;

if (regexReplace.test(content)) {
    content = content.replace(regexReplace, newLogic);
    fs.writeFileSync('src/main.js', content);
    console.log("Upgraded RED logic successfully");
} else {
    console.log("Could not find RED logic regex");
}
