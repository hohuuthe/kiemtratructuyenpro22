const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// 1. switchImportTab function
content = content.replace(/tabRed = document\.getElementById\('tab-red'\);/, "tabUnderline = document.getElementById('tab-underline');")
                 .replace(/contentRed = document\.getElementById\('content-red'\);/, "contentUnderline = document.getElementById('content-underline');")
                 .replace(/tabRed\.className/g, "tabUnderline.className")
                 .replace(/contentRed\.classList/g, "contentUnderline.classList")
                 .replace(/tab === 'red'/g, "tab === 'underline'")
                 .replace(/text-red-600/g, "text-purple-600")
                 .replace(/border-red-600/g, "border-purple-600");

// HTML Modal replacements
content = content.replace(/id="tab-red"/, 'id="tab-underline"')
                 .replace(/switchImportTab\('red'\)/, "switchImportTab('underline')")
                 .replace(/Nhận diện chữ ĐỎ/g, "Nhận diện GẠCH CHÂN")
                 .replace(/id="content-red"/, 'id="content-underline"')
                 .replace(/bg-red-50/g, 'bg-purple-50')
                 .replace(/text-red-700/g, 'text-purple-700')
                 .replace(/📋 Hướng dẫn định dạng \(Chữ màu ĐỎ\):/, '📋 Hướng dẫn định dạng (Chữ Gạch Chân):')
                 .replace(/<span style="color:red; font-weight:bold;">/g, '<u><span style="font-weight:bold; color:purple;">')
                 .replace(/\(được bôi đỏ\)/g, '(được gạch chân)')
                 .replace(/<\/span>B\./, '</span></u>B.') // wait, the original is </span>
                 .replace(/<\/span>/g, '</span></u>') // wait, only inside the pre blocks of this modal.

// Let's do the HTML modal more precisely:
const oldModalPart = `
                    <div id="content-red" class="mb-4 p-4 bg-red-50 rounded-lg hidden">
                        <h4 class="font-bold text-red-700 mb-2">📋 Hướng dẫn định dạng (Chữ màu ĐỎ):</h4>
                        <div class="text-sm text-gray-600 space-y-2">
                            <p><strong>Câu hỏi [4-1] - Trắc nghiệm:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 1: [BAI 1][NB][4-1] Nội dung câu hỏi
A. Đáp án sai
<span style="color:red; font-weight:bold;">B. Đáp án đúng (được bôi đỏ)</span>
C. Đáp án sai
D. Đáp án sai</pre>
                            
                            <p><strong>Câu hỏi [TF4] - Đúng/Sai:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 2: [BAI 1][TH][TF4] Nội dung câu hỏi
<span style="color:red; font-weight:bold;">A. Phát biểu ĐÚNG (được bôi đỏ)</span>
B. Phát biểu SAI
<span style="color:red; font-weight:bold;">C. Phát biểu ĐÚNG (được bôi đỏ)</span>
D. Phát biểu SAI</pre>
                            
                            <p><strong>Câu hỏi [SQ] & [TL]:</strong> Vẫn bắt buộc dùng dòng <code class="bg-white px-1 py-0.5 rounded text-red-600">Đáp án: ...</code> như tab mặc định.</p>
                        </div>
                    </div>`;

const newModalPart = `
                    <div id="content-underline" class="mb-4 p-4 bg-purple-50 rounded-lg hidden">
                        <h4 class="font-bold text-purple-700 mb-2">📋 Hướng dẫn định dạng (Chữ Gạch Chân):</h4>
                        <div class="text-sm text-gray-600 space-y-2">
                            <p><strong>Câu hỏi [4-1] - Trắc nghiệm:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 1: [BAI 1][NB][4-1] Nội dung câu hỏi
A. Đáp án sai
<u><span style="color:purple; font-weight:bold;">B. Đáp án đúng (được gạch chân)</span></u>
C. Đáp án sai
D. Đáp án sai</pre>
                            
                            <p><strong>Câu hỏi [TF4] - Đúng/Sai:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 2: [BAI 1][TH][TF4] Nội dung câu hỏi
<u><span style="color:purple; font-weight:bold;">A. Phát biểu ĐÚNG (được gạch chân)</span></u>
B. Phát biểu SAI
<u><span style="color:purple; font-weight:bold;">C. Phát biểu ĐÚNG (được gạch chân)</span></u>
D. Phát biểu SAI</pre>
                            
                            <p><strong>Câu hỏi [SQ] & [TL]:</strong> Vẫn bắt buộc dùng dòng <code class="bg-white px-1 py-0.5 rounded text-purple-600">Đáp án: ...</code> như tab mặc định.</p>
                        </div>
                    </div>`;

// Apply modal replacement first
content = content.replace(oldModalPart.trim(), newModalPart.trim());

// We also need to fix switchImportTab function string replacements properly.
fs.writeFileSync('src/main.js', content);
console.log("Replaced modal HTML");
