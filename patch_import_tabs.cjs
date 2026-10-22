const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldModalContentStart = `                    <h3 class="text-xl font-bold text-gray-800 mb-4">📥 Import câu hỏi từ Word</h3>
                    <div class="mb-4 p-4 bg-blue-50 rounded-lg">
                        <h4 class="font-bold text-blue-700 mb-2">📋 Hướng dẫn định dạng:</h4>
                        <div class="text-sm text-gray-600 space-y-2">
                            <p><strong>Câu hỏi [4-1] - Trắc nghiệm:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 1: [BAI 1][NB][4-1] Nội dung câu hỏi
A. Đáp án A
B. Đáp án B
C. Đáp án C
D. Đáp án D
Đáp án: A</pre>
                            
                            <p><strong>Câu hỏi [TF4] - Đúng/Sai:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 2: [BAI 1][TH][TF4] Nội dung câu hỏi
A. Phát biểu 1
B. Phát biểu 2
C. Phát biểu 3
D. Phát biểu 4
Đáp án: A&C</pre>
                            
                            <p><strong>Câu hỏi [SQ] - Tự luận ngắn:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 3: [BAI 2][VD][SQ] Nội dung câu hỏi
Đáp án: 123</pre>
                            <p><strong>Câu hỏi [TL] - Tự luận:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 4: [BAI 3][VD][TL] Nội dung câu hỏi tự luận
Đáp án: Hướng dẫn chấm chi tiết...</pre>
                        </div>
                    </div>`;

const newModalContentStart = `                    <h3 class="text-xl font-bold text-gray-800 mb-4">📥 Import câu hỏi từ Word</h3>
                    
                    <div class="flex border-b border-gray-200 mb-4">
                        <button type="button" id="tab-default" class="w-1/2 py-2 text-sm font-semibold text-blue-600 border-b-2 border-blue-600 focus:outline-none" onclick="switchImportTab('default')">Từ khóa "Đáp án:"</button>
                        <button type="button" id="tab-red" class="w-1/2 py-2 text-sm font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300 focus:outline-none" onclick="switchImportTab('red')">Nhận diện chữ ĐỎ</button>
                    </div>
                    <input type="hidden" id="import-answer-format" value="default">

                    <div id="content-default" class="mb-4 p-4 bg-blue-50 rounded-lg">
                        <h4 class="font-bold text-blue-700 mb-2">📋 Hướng dẫn định dạng (Mặc định):</h4>
                        <div class="text-sm text-gray-600 space-y-2">
                            <p><strong>Câu hỏi [4-1] - Trắc nghiệm:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 1: [BAI 1][NB][4-1] Nội dung câu hỏi
A. Đáp án A
B. Đáp án B
C. Đáp án C
D. Đáp án D
Đáp án: A</pre>
                            
                            <p><strong>Câu hỏi [TF4] - Đúng/Sai:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 2: [BAI 1][TH][TF4] Nội dung câu hỏi
A. Phát biểu 1
B. Phát biểu 2
C. Phát biểu 3
D. Phát biểu 4
Đáp án: A&C</pre>
                            
                            <p><strong>Câu hỏi [SQ] - Tự luận ngắn:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 3: [BAI 2][VD][SQ] Nội dung câu hỏi
Đáp án: 123</pre>
                            <p><strong>Câu hỏi [TL] - Tự luận:</strong></p>
                            <pre class="bg-white p-2 rounded text-xs overflow-x-auto">Câu 4: [BAI 3][VD][TL] Nội dung câu hỏi tự luận
Đáp án: Hướng dẫn chấm chi tiết...</pre>
                        </div>
                    </div>

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

content = content.replace(oldModalContentStart, newModalContentStart);

const oldSelector = `                    <div class="mb-4">
                        <label class="block text-sm font-semibold text-gray-700 mb-1">Phương thức đánh dấu đáp án đúng:</label>
                        <select id="import-answer-format" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:bg-white transition focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="default">Từ khóa "Đáp án:" ở cuối câu</option>
                            <option value="red">Tự động nhận diện chữ màu ĐỎ (Dành cho 4-1 và TF4)</option>
                        </select>
                    </div>`;

content = content.replace(oldSelector, "");

const scriptToAdd = `
        window.switchImportTab = function(tab) {
            document.getElementById('import-answer-format').value = tab;
            
            const tabDefault = document.getElementById('tab-default');
            const tabRed = document.getElementById('tab-red');
            const contentDefault = document.getElementById('content-default');
            const contentRed = document.getElementById('content-red');
            
            if (tab === 'default') {
                tabDefault.className = 'w-1/2 py-2 text-sm font-semibold text-blue-600 border-b-2 border-blue-600 focus:outline-none';
                tabRed.className = 'w-1/2 py-2 text-sm font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300 focus:outline-none';
                contentDefault.classList.remove('hidden');
                contentRed.classList.add('hidden');
            } else {
                tabRed.className = 'w-1/2 py-2 text-sm font-semibold text-red-600 border-b-2 border-red-600 focus:outline-none';
                tabDefault.className = 'w-1/2 py-2 text-sm font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300 focus:outline-none';
                contentRed.classList.remove('hidden');
                contentDefault.classList.add('hidden');
            }
        };
`;

if (!content.includes('window.switchImportTab')) {
    const importModalFunction = 'window.showImportModal = function showImportModal() {';
    content = content.replace(importModalFunction, scriptToAdd + '\n        ' + importModalFunction);
}

fs.writeFileSync('src/main.js', content);
console.log("Patched tabs");
