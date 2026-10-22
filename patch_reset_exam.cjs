const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

const oldBlock = `            } else {
                if (document.getElementById('guest_data_1')) document.getElementById('guest_data_1').value = '';
                if (document.getElementById('guest_data_2')) document.getElementById('guest_data_2').value = '';
            }`;

const newBlock = `            } else {
                // Yêu cầu: Không xóa ô họ tên, lớp của học sinh khi chọn giáo viên hoặc đề thi
                // Bỏ qua việc xóa dữ liệu
            }`;

if (content.includes(oldBlock)) {
    content = content.replace(oldBlock, newBlock);
    fs.writeFileSync('src/main.js', content);
    console.log('Successfully patched resetExam in src/main.js');
} else {
    console.log('Could not find the target block in src/main.js');
}
