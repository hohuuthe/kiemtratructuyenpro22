const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexOldJSZip = /if \(answerFormat === 'red' && window\.JSZip\) {[\s\S]*?} catch \(e\) {[\s\S]*?console\.error\('JSZip color map error', e\);[\s\S]*?}[\s\S]*?}/;

const newJSZip = `if (answerFormat === 'red' && window.JSZip) {
                    try {
                        const zip = await JSZip.loadAsync(arrayBuffer);
                        if (zip.file("word/document.xml")) {
                            let xmlStr = await zip.file("word/document.xml").async("string");
                            
                            // Sử dụng DOMParser để bóc tách XML
                            const parser = new DOMParser();
                            const xmlDoc = parser.parseFromString(xmlStr, "application/xml");
                            
                            const isRed = (v) => {
                                if (!v) return false;
                                v = v.toUpperCase();
                                if (v === 'RED' || v === 'FF0000' || v === 'C00000' || v === 'E53935' || v === 'D32F2F') return true;
                                if (/^[0-9A-F]{6}$/.test(v)) {
                                    const r = parseInt(v.substring(0,2), 16);
                                    const g = parseInt(v.substring(2,4), 16);
                                    const b = parseInt(v.substring(4,6), 16);
                                    // Chấp nhận màu có sắc đỏ trội
                                    if (r > 120 && g < 120 && b < 120 && r > (g + 30) && r > (b + 30)) return true;
                                }
                                return false;
                            };

                            const wRuns = xmlDoc.getElementsByTagName("w:r");
                            for (let i = 0; i < wRuns.length; i++) {
                                const run = wRuns[i];
                                let runIsRed = false;
                                
                                const colorNodes = run.getElementsByTagName("w:color");
                                if (colorNodes.length > 0) {
                                    const val = colorNodes[0].getAttribute("w:val");
                                    if (isRed(val)) runIsRed = true;
                                }
                                
                                const highlightNodes = run.getElementsByTagName("w:highlight");
                                if (highlightNodes.length > 0) {
                                    const val = highlightNodes[0].getAttribute("w:val");
                                    if (val && (val.toLowerCase() === 'red' || val.toLowerCase() === 'magenta')) {
                                        runIsRed = true;
                                    }
                                }
                                
                                if (runIsRed) {
                                    const tNodes = run.getElementsByTagName("w:t");
                                    for (let j = 0; j < tNodes.length; j++) {
                                        if (tNodes[j].textContent && tNodes[j].textContent.trim().length > 0) {
                                            tNodes[j].textContent = "[[RED]]" + tNodes[j].textContent + "[[/RED]]";
                                        }
                                    }
                                }
                            }
                            
                            const serializer = new XMLSerializer();
                            const newXmlStr = serializer.serializeToString(xmlDoc);
                            zip.file("word/document.xml", newXmlStr);
                            arrayBuffer = await zip.generateAsync({type: "arraybuffer"});
                        }
                    } catch (e) {
                        console.error('JSZip color map error', e);
                    }
                }`;

if (regexOldJSZip.test(content)) {
    content = content.replace(regexOldJSZip, newJSZip);
    fs.writeFileSync('src/main.js', content);
    console.log("Replaced JSZip logic successfully");
} else {
    console.log("Could not find JSZip regex");
}
