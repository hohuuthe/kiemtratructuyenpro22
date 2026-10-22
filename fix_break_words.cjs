const fs = require('fs');

let htmlContent = fs.readFileSync('public/components/tab-exam.html', 'utf8');

htmlContent = htmlContent.replace(
    `<p id="exam-student-name" class="font-black text-gray-800 text-xl md:text-3xl"></p>`,
    `<p id="exam-student-name" class="font-black text-gray-800 text-xl md:text-3xl break-words w-full max-w-[90vw]"></p>`
);

htmlContent = htmlContent.replace(
    `<p id="exam-title" class="font-bold text-gray-700" style="font-size: clamp(1rem, 2.5vw, 1.4rem);"></p>`,
    `<p id="exam-title" class="font-bold text-gray-700 break-words w-full" style="font-size: clamp(1rem, 2.5vw, 1.4rem);"></p>`
);

// Cũng làm tương tự cho title ở bảng nộp bài
fs.writeFileSync('public/components/tab-exam.html', htmlContent);
console.log("Updated break-words for long names.");
