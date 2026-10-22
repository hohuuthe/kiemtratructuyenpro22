const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexReplaceBlock = /if \(answerFormat === 'red' && window\.JSZip\) \{[\s\S]*?console\.error\('JSZip color map error', e\);\s*\}\s*\}/;

const newBlock = `if (answerFormat === 'underline' && window.JSZip) {
                    try {
                        const zip = await JSZip.loadAsync(arrayBuffer);
                        if (zip.file("word/document.xml")) {
                            let xmlStr = await zip.file("word/document.xml").async("string");
                            
                            // Sử dụng DOMParser để bóc tách XML
                            const parser = new DOMParser();
                            const xmlDoc = parser.parseFromString(xmlStr, "application/xml");
                            
                            const isUnderlined = (uNode) => {
                                if (!uNode) return false;
                                const val = uNode.getAttribute("w:val");
                                return val && val !== 'none';
                            };

                            const paragraphs = xmlDoc.getElementsByTagName("w:p");
                            for (let p = 0; p < paragraphs.length; p++) {
                                const para = paragraphs[p];
                                let pIsUnderlined = false;

                                const pPrs = para.getElementsByTagName("w:pPr");
                                if (pPrs.length > 0) {
                                    const pPrU = pPrs[0].getElementsByTagName("w:u");
                                    if (pPrU.length > 0 && isUnderlined(pPrU[0])) {
                                        pIsUnderlined = true;
                                    }
                                }

                                const runs = para.getElementsByTagName("w:r");
                                for (let i = 0; i < runs.length; i++) {
                                    const run = runs[i];
                                    let runIsUnderlined = pIsUnderlined;

                                    if (!runIsUnderlined) {
                                        const rPrs = run.getElementsByTagName("w:rPr");
                                        if (rPrs.length > 0) {
                                            const rPrU = rPrs[0].getElementsByTagName("w:u");
                                            if (rPrU.length > 0 && isUnderlined(rPrU[0])) {
                                                runIsUnderlined = true;
                                            }
                                        }
                                    }
                                    
                                    if (runIsUnderlined) {
                                        const tNodes = run.getElementsByTagName("w:t");
                                        for (let j = 0; j < tNodes.length; j++) {
                                            if (tNodes[j].textContent && tNodes[j].textContent.trim().length > 0) {
                                                tNodes[j].textContent = "[[U]]" + tNodes[j].textContent + "[[/U]]";
                                            }
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
                        console.error('JSZip underline map error', e);
                    }
                }`;

if (regexReplaceBlock.test(content)) {
    content = content.replace(regexReplaceBlock, newBlock);
    fs.writeFileSync('src/main.js', content);
    console.log("Successfully replaced XML parsing block.");
} else {
    console.log("Could not find regexReplaceBlock in source.");
}
