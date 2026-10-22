const fs = require('fs');
let content = fs.readFileSync('src/main.js', 'utf8');

// 1. Fix Table Image Extraction (so multiple images in a row are not lost)
const oldTableExtraction = `const img = row.querySelector('img');
                            const imgSrc = img ? img.getAttribute('src') : '';
                            if (rowText || imgSrc) {
                                lines.push({ text: rowText, image: imgSrc });
                            }`;

const newTableExtraction = `const imgs = Array.from(row.querySelectorAll('img'));
                            if (imgs.length > 0) {
                                lines.push({ text: rowText, image: imgs[0].getAttribute('src') });
                                for (let idx = 1; idx < imgs.length; idx++) {
                                    lines.push({ text: '', image: imgs[idx].getAttribute('src') });
                                }
                            } else if (rowText) {
                                lines.push({ text: rowText, image: '' });
                            }`;
content = content.replace(oldTableExtraction, newTableExtraction);

// 2. Fix Option First-Match Image Assignment
const oldInlineImageAssign = `if (lines[i].image && currentOpt) {
                                    if (!question.options[currentOpt].image) {
                                        question.options[currentOpt].image = lines[i].image;
                                    }
                                }`;

const newInlineImageAssign = `if (lines[i].image && typeof robustMatches !== 'undefined' && robustMatches.length > 0) {
                                    let firstOptLetter = robustMatches[0][1].toUpperCase();
                                    if (question.options[firstOptLetter] && !question.options[firstOptLetter].image) {
                                        question.options[firstOptLetter].image = lines[i].image;
                                    }
                                } else if (lines[i].image && currentOpt) {
                                    if (!question.options[currentOpt].image) {
                                        question.options[currentOpt].image = lines[i].image;
                                    }
                                }`;
content = content.replace(oldInlineImageAssign, newInlineImageAssign);

// 3. Add Post-processing block right after the 'while (i < lines.length)' finishes for options parsing
const oldPostProcessAnchor = `// Đánh giá Trọng số Đáp án`;
const newPostProcessBlock = `// --- HẬU XỬ LÝ HÌNH ẢNH (CHỐNG NHẦM LẪN ẢNH CÂU HỎI VÀ ĐÁP ÁN) ---
                        // Nếu chỉ có ĐÚNG 1 đáp án có chứa ảnh, 
                        // trong khi các đáp án khác không có ảnh, và câu hỏi đang KHÔNG có ảnh.
                        // Đồng thời đáp án này có chứa chữ Text (VD: "D. Đồ thị").
                        // Thì 99% đây là bức ảnh của Câu hỏi bị trôi xuống dưới cùng.
                        let optsWithImages = ['A', 'B', 'C', 'D'].filter(opt => question.options[opt] && question.options[opt].image);
                        if (optsWithImages.length === 1) {
                            let theOnlyOpt = optsWithImages[0];
                            if (question.options[theOnlyOpt].text.trim() !== '') {
                                if (!question.image) {
                                    question.image = question.options[theOnlyOpt].image;
                                    question.options[theOnlyOpt].image = '';
                                }
                            }
                        }
                        
                        // Đánh giá Trọng số Đáp án`;

content = content.replace(oldPostProcessAnchor, newPostProcessBlock);

fs.writeFileSync('src/main.js', content);
console.log("Image logic patched successfully.");
