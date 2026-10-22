const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexReplaceBlock = /if \(answerFormat === 'underline' && window\.JSZip\) \{[\s\S]*?console\.error\('JSZip underline map error', e\);\s*\}\s*\}/;

const newBlock = `if ((answerFormat === 'underline' || answerFormat === 'bold') && window.JSZip) {
                    try {
                        const zip = await JSZip.loadAsync(arrayBuffer);
                        if (zip.file("word/document.xml")) {
                            let xmlStr = await zip.file("word/document.xml").async("string");
                            
                            const parser = new DOMParser();
                            const xmlDoc = parser.parseFromString(xmlStr, "application/xml");
                            
                            const checkMarking = (node, tagType) => {
                                if (!node) return false;
                                const val = node.getAttribute("w:val");
                                if (tagType === 'u') return val && val !== 'none';
                                if (tagType === 'b') return !val || (val !== '0' && val !== 'false' && val !== 'none'); // bold defaults to true if present
                                return false;
                            };

                            const tagName = answerFormat === 'underline' ? 'w:u' : 'w:b';
                            const openTag = answerFormat === 'underline' ? '[[U]]' : '[[B]]';
                            const closeTag = answerFormat === 'underline' ? '[[/U]]' : '[[/B]]';

                            const paragraphs = xmlDoc.getElementsByTagName("w:p");
                            for (let p = 0; p < paragraphs.length; p++) {
                                const para = paragraphs[p];
                                let pIsMarked = false;

                                const pPrs = para.getElementsByTagName("w:pPr");
                                if (pPrs.length > 0) {
                                    const pPrTag = pPrs[0].getElementsByTagName(tagName);
                                    if (pPrTag.length > 0 && checkMarking(pPrTag[0], tagName.split(':')[1])) {
                                        pIsMarked = true;
                                    }
                                }

                                const runs = para.getElementsByTagName("w:r");
                                for (let i = 0; i < runs.length; i++) {
                                    const run = runs[i];
                                    let runIsMarked = pIsMarked;

                                    if (!runIsMarked) {
                                        const rPrs = run.getElementsByTagName("w:rPr");
                                        if (rPrs.length > 0) {
                                            const rPrTag = rPrs[0].getElementsByTagName(tagName);
                                            if (rPrTag.length > 0 && checkMarking(rPrTag[0], tagName.split(':')[1])) {
                                                runIsMarked = true;
                                            }
                                        }
                                    }
                                    
                                    if (runIsMarked) {
                                        const tNodes = run.getElementsByTagName("w:t");
                                        for (let j = 0; j < tNodes.length; j++) {
                                            if (tNodes[j].textContent && tNodes[j].textContent.trim().length > 0) {
                                                tNodes[j].textContent = openTag + tNodes[j].textContent + closeTag;
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
                        console.error('JSZip marker map error', e);
                    }
                }`;

if (regexReplaceBlock.test(content)) {
    content = content.replace(regexReplaceBlock, newBlock);
    fs.writeFileSync('src/main.js', content);
    console.log("Patched XML logic.");
} else {
    console.log("Could not find regexReplaceBlock.");
}
