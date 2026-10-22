const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const regexModal = /<div class="mb-4 p-4 bg-blue-50 rounded-lg">([\s\S]*?)<\/div>\s*<div class="mb-4">\s*<label class="block text-sm font-semibold text-gray-700 mb-2">Chọn file Word \(\.docx\)<\/label>/;

const newTabs = `
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
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-semibold text-gray-700 mb-2">Chọn file Word (.docx)</label>`;

if (regexModal.test(content)) {
    content = content.replace(regexModal, newTabs);
    fs.writeFileSync('src/main.js', content);
    console.log("Replaced successfully!");
} else {
    console.log("Regex not found!");
}
