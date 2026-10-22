const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldStr = `            try {
                updateProgress('Đang nạp file Word từ thiết bị...', 15);
                await new Promise(resolve => setTimeout(resolve, 300));
                
                const arrayBuffer = await file.arrayBuffer();
                
                updateProgress('Bắt đầu giải nén & chuyển đổi định dạng tài liệu...', 40);
                await new Promise(resolve => setTimeout(resolve, 300));

                const options = {
                    styleMap: [
                        "p[style-name='Normal'] => p:fresh",
                        "r[style-name='Superscript'] => sup",
                        "r[style-name='Subscript'] => sub"
                    ]
                };`;

const newStr = `            try {
                updateProgress('Đang nạp file Word từ thiết bị...', 15);
                await new Promise(resolve => setTimeout(resolve, 300));
                
                let arrayBuffer = await file.arrayBuffer();
                const answerFormat = document.getElementById('import-answer-format')?.value || 'default';
                
                updateProgress('Bắt đầu giải nén & chuyển đổi định dạng tài liệu...', 40);
                await new Promise(resolve => setTimeout(resolve, 300));

                if (answerFormat === 'red' && window.JSZip) {
                    try {
                        const zip = await JSZip.loadAsync(arrayBuffer);
                        if (zip.file("word/document.xml")) {
                            let xml = await zip.file("word/document.xml").async("string");
                            xml = xml.replace(/<w:color w:val="([^"]+)"\\s*\\/?>(<\\/w:color>)?/g, (match, val) => {
                                const v = val.toUpperCase();
                                if (v === 'RED' || v === 'FF0000' || v === 'C00000' || v === 'E53935' || v === 'D32F2F' || /^F[0-9A-F]0000$/.test(v)) {
                                    return match + '<w:rStyle w:val="RedText"/>';
                                }
                                if (/^[0-9A-F]{6}$/.test(v)) {
                                    const r = parseInt(v.substring(0,2), 16);
                                    const g = parseInt(v.substring(2,4), 16);
                                    const b = parseInt(v.substring(4,6), 16);
                                    if (r > 150 && g < 100 && b < 100) return match + '<w:rStyle w:val="RedText"/>';
                                }
                                return match;
                            });
                            zip.file("word/document.xml", xml);
                            arrayBuffer = await zip.generateAsync({type: "arraybuffer"});
                        }
                    } catch (e) {
                        console.error('JSZip color map error', e);
                    }
                }

                const options = {
                    styleMap: [
                        "p[style-name='Normal'] => p:fresh",
                        "r[style-name='Superscript'] => sup",
                        "r[style-name='Subscript'] => sub",
                        "r[style-name='RedText'] => span.red-text"
                    ]
                };`;

if (content.includes(oldStr)) {
    content = content.replace(oldStr, newStr);
    console.log("Patched mammoth options");
} else {
    console.log("Could not find mammoth options");
}

fs.writeFileSync('src/main.js', content);
