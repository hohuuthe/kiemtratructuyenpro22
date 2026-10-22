const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldStr = `                            <input type="file" id="import-file" accept=".docx" class="hidden" onchange="const f = this.files[0]; if(f){ document.getElementById('docx-file-name').textContent = 'Đã chọn: ' + f.name; document.getElementById('docx-file-name').classList.remove('hidden'); }">
                        </div>
                    </div>
                    <div id="import-progress-container" class="mb-4 hidden p-4 bg-blue-50/50 border border-blue-100 rounded-xl">`;

const newStr = `                            <input type="file" id="import-file" accept=".docx" class="hidden" onchange="const f = this.files[0]; if(f){ document.getElementById('docx-file-name').textContent = 'Đã chọn: ' + f.name; document.getElementById('docx-file-name').classList.remove('hidden'); }">
                        </div>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-semibold text-gray-700 mb-1">Phương thức đánh dấu đáp án đúng:</label>
                        <select id="import-answer-format" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:bg-white transition focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="default">Từ khóa "Đáp án:" ở cuối câu</option>
                            <option value="red">Tự động nhận diện chữ màu ĐỎ (Dành cho 4-1 và TF4)</option>
                        </select>
                    </div>
                    <div id="import-progress-container" class="mb-4 hidden p-4 bg-blue-50/50 border border-blue-100 rounded-xl">`;

if (content.includes(oldStr)) {
    content = content.replace(oldStr, newStr);
    console.log("Patched import UI");
} else {
    console.log("Could not find import UI");
}

fs.writeFileSync('src/main.js', content);
