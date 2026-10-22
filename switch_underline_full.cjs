const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// Replace tab logic
content = content.replace(/tabRed = document.getElementById\('tab-red'\)/, "tabUnderline = document.getElementById('tab-underline')")
    .replace(/contentRed = document.getElementById\('content-red'\)/, "contentUnderline = document.getElementById('content-underline')")
    .replace(/tabRed\.className/g, "tabUnderline.className")
    .replace(/contentRed\.classList/g, "contentUnderline.classList")
    .replace(/tab === 'red'/g, "tab === 'underline'")
    .replace(/text-red-600/g, "text-purple-600")
    .replace(/border-red-600/g, "border-purple-600")
    .replace(/id="tab-red"/, 'id="tab-underline"')
    .replace(/switchImportTab\('red'\)/, "switchImportTab('underline')")
    .replace(/Nhận diện chữ ĐỎ/, "Nhận diện GẠCH CHÂN")
    .replace(/id="content-red"/, 'id="content-underline"');

// Wait, earlier script already ran and replaced some parts, but maybe wait, let's see what earlier script did.
