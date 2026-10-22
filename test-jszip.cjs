const JSZip = require("jszip");
const fs = require("fs");

async function run() {
    const buffer = fs.readFileSync("test.docx");
    const zip = await JSZip.loadAsync(buffer);
    let xml = await zip.file("word/document.xml").async("string");
    
    // Replace <w:color w:val="..."/> with <w:rStyle w:val="RedText"/> if it's red
    xml = xml.replace(/<w:color w:val="([^"]+)"\s*\/?>(<\/w:color>)?/g, (match, val) => {
        // Red is FF0000, C00000, red, etc.
        // Actually we can just mark anything that is red.
        const v = val.toUpperCase();
        if (v === 'FF0000' || v === 'C00000' || v === 'RED' || v.startsWith('FF00') || v === 'E53935' || v === 'D32F2F') {
            return match + '<w:rStyle w:val="RedText"/>';
        }
        return match;
    });
    
    zip.file("word/document.xml", xml);
    const newBuffer = await zip.generateAsync({type: "nodebuffer"});
    fs.writeFileSync("test2.docx", newBuffer);
    console.log("Done test2.docx");
}
run();
