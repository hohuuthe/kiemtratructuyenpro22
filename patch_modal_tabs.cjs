const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// 1. Replace the tab buttons
const oldTabsHTML = `<div class="flex border-b border-gray-200 mb-4">
                        <button type="button" id="tab-default" class="w-1/2 py-2 text-sm font-semibold text-blue-600 border-b-2 border-blue-600 focus:outline-none" onclick="switchImportTab('default')">Từ khóa "Đáp án:"</button>
                        <button type="button" id="tab-underline" class="w-1/2 py-2 text-sm font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300 focus:outline-none" onclick="switchImportTab('underline')">Nhận diện GẠCH CHÂN</button>
                    </div>`;

const newTabsHTML = `<div class="flex border-b border-gray-200 mb-4">
                        <button type="button" id="tab-default" class="flex-1 py-2 text-sm font-semibold text-blue-600 border-b-2 border-blue-600 focus:outline-none" onclick="switchImportTab('default')">Từ khóa "Đáp án:"</button>
                        <button type="button" id="tab-underline" class="flex-1 py-2 text-sm font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300 focus:outline-none" onclick="switchImportTab('underline')">GẠCH CHÂN</button>
                        <button type="button" id="tab-bold" class="flex-1 py-2 text-sm font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300 focus:outline-none" onclick="switchImportTab('bold')">IN ĐẬM</button>
                    </div>`;

content = content.replace(oldTabsHTML, newTabsHTML);

// 2. Add content-bold HTML
const oldContentUnderlineEnd = `                    </div>\n                    <div class="mb-4">`;
const contentBoldHTML = `                    </div>
                    <div id="content-bold" class="mb-4 p-4 bg-orange-50 rounded-lg hidden">
                        <h4 class="font-bold text-orange-700 mb-2">📋 Hướng dẫn định dạng (Chữ In Đậm):</h4>
                        <div class="text-sm text-gray-600 space-y-2">
                            <p><strong>Câu hỏi [4-1] - Trắc nghiệm:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 1: [BAI 1][NB][4-1] Nội dung câu hỏi
A. Đáp án sai
<strong><span style="color:orange;">B. Đáp án đúng (được in đậm)</span></strong>
C. Đáp án sai
D. Đáp án sai</pre>
                            
                            <p><strong>Câu hỏi [TF4] - Đúng/Sai:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 2: [BAI 1][TH][TF4] Nội dung câu hỏi
<strong><span style="color:orange;">A. Phát biểu ĐÚNG (được in đậm)</span></strong>
B. Phát biểu SAI
<strong><span style="color:orange;">C. Phát biểu ĐÚNG (được in đậm)</span></strong>
D. Phát biểu SAI</pre>
                            
                            <p><strong>Câu hỏi [SQ] & [TL]:</strong> Vẫn bắt buộc dùng dòng <code class="bg-white px-1 py-0.5 rounded text-orange-600">Đáp án: ...</code> như tab mặc định.</p>
                        </div>
                    </div>
                    <div class="mb-4">`;
content = content.replace(oldContentUnderlineEnd, contentBoldHTML);

fs.writeFileSync('src/main.js', content);
console.log("Patched modal HTML.");
