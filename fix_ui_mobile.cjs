const fs = require('fs');

let htmlContent = fs.readFileSync('public/components/tab-exam.html', 'utf8');

// 1. Thay đổi container chứa thời gian, cảnh báo cheat, và các nút để cho phép wrap nếu không đủ chỗ
htmlContent = htmlContent.replace(
    `        <div class="flex items-center justify-between md:justify-end gap-3 md:gap-6 bg-white/80 backdrop-blur-sm p-3 md:p-4 rounded-2xl shadow-sm border border-white/50">`,
    `        <div class="flex flex-wrap items-center justify-center sm:justify-between md:justify-end gap-3 md:gap-6 bg-white/80 backdrop-blur-sm p-3 md:p-4 rounded-2xl shadow-sm border border-white/50 w-full overflow-hidden">`
);

// 2. Ẩn chữ "Toàn màn hình" trên mobile siêu nhỏ, chỉ hiện icon. Hoặc cho text bé xíu.
// Thay vì ẩn, hãy bọc nội dung "Toàn màn hình" trong span
htmlContent = htmlContent.replace(
    `            Toàn màn hình`,
    `            <span class="hidden sm:inline">Toàn màn hình</span><span class="sm:hidden text-[10px]">Toàn MH</span>`
);

// Sửa trong thẻ span Nộp bài, nếu text nằm chơi vơi
htmlContent = htmlContent.replace(
    `            Nộp bài\n          </span>`,
    `            <span>Nộp bài</span>\n          </span>`
);

fs.writeFileSync('public/components/tab-exam.html', htmlContent);
console.log("Updated tab-exam.html UI for mobile.");
