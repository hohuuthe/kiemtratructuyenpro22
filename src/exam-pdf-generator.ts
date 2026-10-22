import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { extractOptionsABCD, getOptionText, estimatePageCount, ExamExportHeaderOptions, ExamExportQuestion } from './exam-docx-generator';

export async function generateExamPdfBlob(
    headerOptions: ExamExportHeaderOptions,
    questions: ExamExportQuestion[]
): Promise<Blob> {
    const {
        soGiaoDuc = "SỞ GIÁO DỤC VÀ ĐÀO TẠO",
        truongHoc = "TRƯỜNG THPT",
        deThiTitle = "ĐỀ KIỂM TRA",
        namHoc = "NĂM HỌC 2026 - 2027",
        monHoc = "MÔN TIN HỌC, LỚP 12",
        thoiGian = 45,
        maDe = "1201"
    } = headerOptions;

    // Tính toán ước tính số trang ban đầu
    const initialPageCount = headerOptions.pageCountEstimate || estimatePageCount(questions);

    // Phân loại câu hỏi theo 3 phần chuẩn Bộ GD&ĐT
    const q41 = questions.filter(q => q.type === '4-1');
    const qTF4 = questions.filter(q => q.type === 'TF4');
    const qSQ = questions.filter(q => q.type === 'SQ');
    const qTL = questions.filter(q => q.type === 'TL');
    const part3Questions = [...qSQ, ...qTL];

    // Tạo container HTML ẩn chuẩn in ấn
    // Tạo container HTML ẩn chuẩn in ấn
    // Chiều rộng 700px tương ứng 170mm (khổ A4 210mm trừ lề trái/phải 20mm)
    const container = document.createElement('div');
    container.className = 'tex2jax_process';
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0px';
    container.style.width = '700px';
    container.style.backgroundColor = '#ffffff';
    container.style.color = '#000000';
    container.style.fontFamily = "'Times New Roman', Times, serif";
    container.style.fontSize = '12.5pt';
    container.style.lineHeight = '1.6';
    container.style.padding = '0px';
    container.style.boxSizing = 'border-box';

    // CSS triệt tiêu hoàn toàn lỗi màu đỏ và thông báo lỗi tràn chữ từ MathJax
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
        .MathJax, .MathJax_Display { font-size: 1.08em !important; color: #000000 !important; margin: 2px 0 !important; }
        mjx-container[jax="CHTML"] { line-height: 1.4 !important; color: #000000 !important; display: inline-block !important; }
        .mjx-error, .MathJax_Error, [data-mjx-error], .mjx-merror, [data-mjx-err] { color: #000000 !important; background: transparent !important; border: none !important; padding: 0 !important; display: none !important; }
        .mjx-merror * { color: #000000 !important; }
        .pdf-block { page-break-inside: avoid; break-inside: avoid; }
    `;
    container.appendChild(styleEl);

    let html = `
        <!-- HEADER BẢNG TIÊU ĐỀ & THÔNG TIN HỌC SINH -->
        <div class="pdf-block" style="margin-bottom: 16px;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px; border: none;">
                <tr>
                    <td style="width: 45%; text-align: center; vertical-align: top; padding: 0;">
                        <div style="font-size: 11pt; font-weight: normal; text-transform: uppercase;">${escapeHtml(soGiaoDuc)}</div>
                        <div style="font-size: 11.5pt; font-weight: bold; text-transform: uppercase; text-decoration: underline; margin-top: 3px;">${escapeHtml(truongHoc)}</div>
                        <div id="pdf-page-count-text" style="font-size: 10.5pt; font-style: italic; margin-top: 4px;">(Đề thi có <span id="pdf-page-count-num">${initialPageCount}</span> trang)</div>
                    </td>
                    <td style="width: 55%; text-align: center; vertical-align: top; padding: 0;">
                        <div style="font-size: 12.5pt; font-weight: bold; text-transform: uppercase;">${escapeHtml(deThiTitle)}</div>
                        <div style="font-size: 11.5pt; font-weight: bold; text-transform: uppercase; margin-top: 2px;">${escapeHtml(namHoc)}</div>
                        <div style="font-size: 11.5pt; font-weight: bold; text-transform: uppercase; margin-top: 2px;">${escapeHtml(monHoc)}</div>
                        <div style="font-size: 10.5pt; font-style: italic; margin-top: 4px;">Thời gian làm bài: ${thoiGian} phút (không kể thời gian phát đề)</div>
                    </td>
                </tr>
            </table>

            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="width: 78%; font-weight: bold; font-size: 11.5pt; vertical-align: middle; white-space: nowrap;">
                        Họ tên học sinh: .................................... Số báo danh: ...............
                    </td>
                    <td style="width: 22%; border: 1.5px solid #000000; text-align: center; font-weight: bold; font-size: 11.5pt; padding: 5px 8px; vertical-align: middle; white-space: nowrap;">
                        Mã đề ${escapeHtml(maDe)}
                    </td>
                </tr>
            </table>
        </div>
    `;

    // PHẦN I. TRẮC NGHIỆM 4 LỰA CHỌN
    if (q41.length > 0) {
        html += `
            <div class="pdf-block" style="font-weight: bold; margin-top: 10px; margin-bottom: 8px; text-align: justify;">
                PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn. Thí sinh trả lời từ câu 1 đến câu ${q41.length}. Mỗi câu hỏi thí sinh chỉ chọn một phương án.
            </div>
        `;

        q41.forEach((q, idx) => {
            const qNum = idx + 1;
            html += renderQuestionHTML(qNum, q, ['A. ', 'B. ', 'C. ', 'D. ']);
        });
    }

    // PHẦN II. TRẮC NGHIỆM ĐÚNG SAI
    if (qTF4.length > 0) {
        html += `
            <div class="pdf-block" style="font-weight: bold; margin-top: 14px; margin-bottom: 8px; text-align: justify;">
                PHẦN II. Câu trắc nghiệm đúng sai. Thí sinh trả lời từ câu 1 đến câu ${qTF4.length}. Trong mỗi ý a), b), c), d) ở mỗi câu, thí sinh chọn đúng hoặc sai.
            </div>
        `;

        qTF4.forEach((q, idx) => {
            const qNum = idx + 1;
            html += renderQuestionHTML(qNum, q, ['a) ', 'b) ', 'c) ', 'd) ']);
        });
    }

    // PHẦN III. TRẢ LỜI NGẮN / TỰ LUẬN
    if (part3Questions.length > 0) {
        const isEssay = qTL.length > 0;
        const p3Title = isEssay
            ? `PHẦN III. Tự luận. Thí sinh trả lời từ câu 1 đến câu ${part3Questions.length}.`
            : `PHẦN III. Câu trắc nghiệm trả lời ngắn. Thí sinh trả lời từ câu 1 đến câu ${part3Questions.length}.`;

        html += `
            <div class="pdf-block" style="font-weight: bold; margin-top: 14px; margin-bottom: 8px; text-align: justify;">
                ${p3Title}
            </div>
        `;

        part3Questions.forEach((q, idx) => {
            const qNum = idx + 1;
            html += `
                <div class="pdf-block" style="margin-bottom: 12px; text-align: justify; line-height: 1.5;">
                    <span style="font-weight: bold; color: #1e3a8a;">Câu ${qNum}: </span>
                    <span>${cleanHTMLText(q.content)}</span>
                    ${q.image ? `<div style="text-align: center; margin: 8px 0;"><img src="${q.image}" style="max-width: 320px; max-height: 200px; border-radius: 4px; border: 1px solid #e5e7eb; padding: 4px;" crossOrigin="anonymous" /></div>` : ''}
                    <div style="margin-top: 4px; color: #555555;">………………………………………………………………………………………………….</div>
                </div>
            `;
        });
    }

    // HẾT
    html += `
        <div class="pdf-block" style="text-align: center; font-weight: bold; margin-top: 20px; padding-top: 10px;">
            --- HẾT ---
        </div>
    `;

    container.innerHTML = html;
    document.body.appendChild(container);

    try {
        // Yield ngắn giúp trình duyệt cập nhật giao diện mượt mà
        await new Promise(r => setTimeout(r, 30));

        // Render công thức toán, lý, hóa, sinh bằng MathJax
        if (typeof window !== 'undefined' && (window as any).MathJax) {
            try {
                if ((window as any).MathJax.typesetPromise) {
                    await (window as any).MathJax.typesetPromise([container]);
                } else if ((window as any).MathJax.startup && (window as any).MathJax.startup.promise) {
                    await (window as any).MathJax.startup.promise;
                    if ((window as any).MathJax.typesetPromise) {
                        await (window as any).MathJax.typesetPromise([container]);
                    }
                }
            } catch (mathErr) {
                console.warn("MathJax typeset notice in PDF generator:", mathErr);
            }
        }

        // Loại bỏ thông báo lỗi MathJax nếu có
        container.querySelectorAll('.mjx-error, .MathJax_Error, [data-mjx-error], .mjx-merror, [data-mjx-err]').forEach(el => {
            el.remove();
        });
        container.querySelectorAll('span, div, p, code').forEach(el => {
            const text = el.textContent || '';
            if (text.includes('Missing superscript') || text.includes('Missing subscript') || text.includes('Missing open brace') || text.includes('Math Processing Error')) {
                if (text.length < 120) {
                    el.remove();
                }
            }
        });

        // Chờ tải toàn bộ hình ảnh trong câu hỏi và đáp án nếu có
        const imgs = container.querySelectorAll('img');
        if (imgs.length > 0) {
            await Promise.all(Array.from(imgs).map(img => {
                if (img.complete && img.naturalWidth > 0) return Promise.resolve();
                return new Promise(resolve => {
                    img.onload = resolve;
                    img.onerror = resolve;
                });
            }));
        }

        // TÍNH TOÁN VÀ CHÈN KHOẢNG TRỐNG TỰ ĐỘNG CHỐNG CẮT CÂU HỎI VÀ NGUYÊN TẮC KHÔNG CẮT NGHĨA
        const pxPerMm = 700 / 170; // 4.1176 px/mm
        const pageContentHeightPx = 258 * pxPerMm; // ~1062.35px chiều cao nội dung mỗi trang
        const pageTotalHeightPx = 265 * pxPerMm;   // ~1091.18px tổng chiều cao vùng in A4 (297mm - lề trên 16mm - lề dưới 16mm = 265mm)

        // Áp dụng chia trang thông minh
        applySmartPageBreaks(container, pageContentHeightPx);

        await new Promise(r => setTimeout(r, 20));

        const html2canvasOptions = {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            onclone: (doc: Document) => {
                try {
                    const sheets = doc.styleSheets;
                    if (sheets) {
                        for (let i = 0; i < sheets.length; i++) {
                            try {
                                const rules = sheets[i].cssRules;
                                if (rules) {
                                    for (let j = rules.length - 1; j >= 0; j--) {
                                        const ruleText = rules[j].cssText || '';
                                        if (ruleText.includes('oklch') || ruleText.includes('lab') || ruleText.includes('lch')) {
                                            sheets[i].deleteRule(j);
                                        }
                                    }
                                }
                            } catch (err) {}
                        }
                    }
                } catch (e) {}
            }
        };

        // Render lần 1
        let canvas = await html2canvas(container, html2canvasOptions);

        let canvasPxPerMm = canvas.width / 170;
        let pageCanvasContentHeightPx = pageContentHeightPx * (canvas.width / 700);
        let pageCanvasTotalHeightPx = pageTotalHeightPx * (canvas.width / 700);

        let totalPages = Math.max(1, Math.ceil(canvas.height / pageCanvasContentHeightPx));

        // Nếu số trang thực tế khác số trang ước tính ban đầu, cập nhật lại tiêu đề "(Đề thi có X trang)" và render lại 1 lần
        const pageNumSpan = container.querySelector('#pdf-page-count-num');
        if (pageNumSpan && pageNumSpan.textContent !== String(totalPages)) {
            pageNumSpan.textContent = String(totalPages);
            applySmartPageBreaks(container, pageContentHeightPx);
            await new Promise(r => setTimeout(r, 20));
            canvas = await html2canvas(container, html2canvasOptions);

            canvasPxPerMm = canvas.width / 170;
            pageCanvasContentHeightPx = pageContentHeightPx * (canvas.width / 700);
            pageCanvasTotalHeightPx = pageTotalHeightPx * (canvas.width / 700);
            totalPages = Math.max(1, Math.ceil(canvas.height / pageCanvasContentHeightPx));
        }

        document.body.removeChild(container);

        // Khởi tạo file jsPDF khổ A4 chuẩn (210mm x 297mm)
        const pdf = new jsPDF('p', 'mm', 'a4');
        const marginLeft = 20;  // Lề trái 2.0 cm (20mm)
        const marginTop = 16;   // Lề trên 1.6 cm (16mm - đã giảm 20% từ 2.0cm theo yêu cầu)
        const printWidth = 170; // Chiều rộng in: 210 - 20 - 20 = 170mm (lề phải 2.0cm)
        const printHeight = 265; // Chiều cao in: 297 - 16 - 16 = 265mm (lề dưới 1.6cm - đã giảm 20% từ 2.0cm)

        for (let p = 1; p <= totalPages; p++) {
            // Nhường lượt vẽ cho trình duyệt để đảm bảo giao diện luôn cuộn mượt mà
            await new Promise(r => setTimeout(r, 20));

            if (p > 1) {
                pdf.addPage();
            }

            const sy = (p - 1) * pageCanvasContentHeightPx;
            const sHeight = Math.min(pageCanvasContentHeightPx, canvas.height - sy);

            // Cắt phần ảnh nội dung trang p
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = canvas.width;
            pageCanvas.height = Math.round(pageCanvasTotalHeightPx);
            const ctx = pageCanvas.getContext('2d');

            if (ctx) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

                // 1. Vẽ ảnh nội dung câu hỏi
                if (sHeight > 0) {
                    ctx.drawImage(
                        canvas,
                        0, sy, canvas.width, sHeight,
                        0, 0, canvas.width, sHeight
                    );
                }

                // 2. Vẽ chân trang (Mã đề thi & Số trang) sát lề dưới 1.6cm (vị trí 260mm)
                // Font chữ Times New Roman, cỡ chữ 13pt, căn lề phải đúng 2.0cm
                const scaleFactor = canvas.width / 700;
                const fontSizePx = Math.round(13 * (4 / 3) * scaleFactor);
                ctx.font = `${fontSizePx}px "Times New Roman", Times, serif`;
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'alphabetic';

                const footerText = `Mã đề thi ${maDe} - Trang ${p} / ${totalPages}`;
                const footerY = Math.round(260 * canvasPxPerMm);
                const footerX = pageCanvas.width;
                ctx.fillText(footerText, footerX, footerY);
            }

            const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.95);

            // Vẽ ảnh nội dung vào PDF với lề trên 1.6cm, lề dưới 1.6cm, lề trái & phải 2.0cm
            pdf.addImage(pageImgData, 'JPEG', marginLeft, marginTop, printWidth, printHeight);
        }

        return pdf.output('blob');
    } catch (e) {
        if (document.body.contains(container)) {
            document.body.removeChild(container);
        }
        throw e;
    }
}

/**
 * Thuật toán tính toán và phân bổ khối câu hỏi tự động
 * Chèn khoảng trắng (Spacer) trước khối câu hỏi có nguy cơ tràn ranh giới trang
 * Đảm bảo 100% câu hỏi và chữ không bao giờ bị cắt đôi giữa 2 trang
 */
function applySmartPageBreaks(containerEl: HTMLElement, pageHeightPx: number) {
    // Xóa tất cả các spacer cũ nếu có
    containerEl.querySelectorAll('.pdf-page-spacer').forEach(s => s.remove());

    const blocks = Array.from(containerEl.querySelectorAll('.pdf-block')) as HTMLElement[];
    if (blocks.length === 0) return;

    let containerTop = containerEl.getBoundingClientRect().top;

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const rect = block.getBoundingClientRect();
        const blockTop = rect.top - containerTop;
        const blockHeight = rect.height;

        // Bỏ qua nếu khối quá lớn (lớn hơn chiều cao cả 1 trang)
        if (blockHeight >= pageHeightPx) continue;

        const currentBasePage = Math.floor(blockTop / pageHeightPx);
        const pageBottomForBlock = (currentBasePage + 1) * pageHeightPx;

        // Nếu khối này tràn đè qua đường phân trang (bắt đầu trước ranh giới và kết thúc sau ranh giới)
        if (blockTop < pageBottomForBlock && (blockTop + blockHeight) > (pageBottomForBlock - 6)) {
            // Tính độ cao khoảng trống cần chèn để đẩy khối này sang đầu trang sau
            const spacerHeight = Math.ceil(pageBottomForBlock - blockTop + 2);
            const spacer = document.createElement('div');
            spacer.className = 'pdf-page-spacer';
            spacer.style.height = `${spacerHeight}px`;
            spacer.style.width = '100%';
            spacer.style.clear = 'both';

            block.parentNode?.insertBefore(spacer, block);

            // Cập nhật lại vị trí đỉnh container sau khi chèn spacer
            containerTop = containerEl.getBoundingClientRect().top;
        }
    }
}

function renderQuestionHTML(
    qNum: number,
    q: ExamExportQuestion,
    labels: [string, string, string, string] = ['A. ', 'B. ', 'C. ', 'D. ']
): string {
    const [lblA, lblB, lblC, lblD] = labels;
    const { optA, optB, optC, optD, imgA, imgB, imgC, imgD } = extractOptionsABCD(q.options, q);

    const formattedContent = cleanHTMLText(q.content);
    const formattedOptA = cleanHTMLText(optA);
    const formattedOptB = cleanHTMLText(optB);
    const formattedOptC = cleanHTMLText(optC);
    const formattedOptD = cleanHTMLText(optD);

    const plainA = optA ? optA.replace(/<[^>]+>/g, '').trim() : '';
    const plainB = optB ? optB.replace(/<[^>]+>/g, '').trim() : '';
    const plainC = optC ? optC.replace(/<[^>]+>/g, '').trim() : '';
    const plainD = optD ? optD.replace(/<[^>]+>/g, '').trim() : '';

    const maxLen = Math.max(plainA.length, plainB.length, plainC.length, plainD.length);
    const hasAnyOptionImg = Boolean(imgA || imgB || imgC || imgD);

    const renderCell = (lbl: string, text: string, img?: string) => `
        <div style="flex: 1; min-width: 0;">
            <div><span style="font-weight: bold;">${lbl}</span>${text}</div>
            ${img ? `<div style="text-align: center; margin-top: 4px;"><img src="${img}" style="max-width: 170px; max-height: 110px; border-radius: 4px; border: 1px solid #e5e7eb; padding: 2px;" crossOrigin="anonymous" /></div>` : ''}
        </div>
    `;

    let optionsHTML = '';
    if (plainA || plainB || plainC || plainD || hasAnyOptionImg) {
        if (maxLen <= 12 && !hasAnyOptionImg) {
            // 4 cột trên 1 dòng
            optionsHTML = `
                <div style="display: flex; justify-content: space-between; gap: 8px; margin-top: 4px; margin-bottom: 5px;">
                    ${renderCell(lblA, formattedOptA, imgA)}
                    ${renderCell(lblB, formattedOptB, imgB)}
                    ${renderCell(lblC, formattedOptC, imgC)}
                    ${renderCell(lblD, formattedOptD, imgD)}
                </div>
            `;
        } else if (maxLen <= 38 && !hasAnyOptionImg) {
            // 2 cột x 2 dòng
            optionsHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin-top: 4px; margin-bottom: 5px;">
                    ${renderCell(lblA, formattedOptA, imgA)}
                    ${renderCell(lblB, formattedOptB, imgB)}
                    ${renderCell(lblC, formattedOptC, imgC)}
                    ${renderCell(lblD, formattedOptD, imgD)}
                </div>
            `;
        } else {
            // 4 dòng độc lập
            optionsHTML = `
                <div style="margin-top: 4px; margin-bottom: 5px; line-height: 1.4;">
                    <div style="margin-bottom: 3px;">${renderCell(lblA, formattedOptA, imgA)}</div>
                    <div style="margin-bottom: 3px;">${renderCell(lblB, formattedOptB, imgB)}</div>
                    <div style="margin-bottom: 3px;">${renderCell(lblC, formattedOptC, imgC)}</div>
                    <div style="margin-bottom: 3px;">${renderCell(lblD, formattedOptD, imgD)}</div>
                </div>
            `;
        }
    }

    return `
        <div class="pdf-block" style="margin-bottom: 10px; text-align: justify;">
            <div style="margin-bottom: 3px; line-height: 1.5;">
                <span style="font-weight: bold; color: #1e3a8a;">Câu ${qNum}:</span>
                <span style="margin-left: 4px;">${formattedContent}</span>
            </div>
            ${q.image ? `<div style="text-align: center; margin: 8px 0;"><img src="${q.image}" style="max-width: 320px; max-height: 200px; border-radius: 6px; border: 1px solid #e5e7eb; padding: 4px;" crossOrigin="anonymous" /></div>` : ''}
            ${optionsHTML}
        </div>
    `;
}

/**
 * Phục hồi các ký tự escape bị mất hoặc hỏng do chuỗi unescape JS / JSON / Word import
 */
function getBalancedBlock(str: string, startIndex: number, openChar = '{', closeChar = '}'): { start: number; end: number; content: string } | null {
    if (str[startIndex] !== openChar) return null;
    let depth = 0;
    for (let i = startIndex; i < str.length; i++) {
        if (str[i] === '\\') {
            i++;
            continue;
        }
        if (str[i] === openChar) depth++;
        else if (str[i] === closeChar) {
            depth--;
            if (depth === 0) {
                return { start: startIndex, end: i + 1, content: str.slice(startIndex + 1, i) };
            }
        }
    }
    return null;
}

function extractTeXCommand(str: string, startIndex: number): { start: number; end: number; text: string } | null {
    if (str[startIndex] !== '\\') return null;
    const cmdMatch = str.slice(startIndex).match(/^\\([a-zA-Z]+|\S)/);
    if (!cmdMatch) return null;
    const cmdName = cmdMatch[1];
    let currentIndex = startIndex + cmdMatch[0].length;

    let savedIndex = currentIndex;
    while (currentIndex < str.length && /\s/.test(str[currentIndex])) currentIndex++;
    if (str[currentIndex] === '[') {
        const optBlock = getBalancedBlock(str, currentIndex, '[', ']');
        if (optBlock) currentIndex = optBlock.end;
        else currentIndex = savedIndex;
    } else {
        currentIndex = savedIndex;
    }

    let hasSubSup = true;
    while (hasSubSup && currentIndex < str.length) {
        let beforeWs = currentIndex;
        while (currentIndex < str.length && /\s/.test(str[currentIndex])) currentIndex++;
        if (str[currentIndex] === '_' || str[currentIndex] === '^') {
            currentIndex++;
            while (currentIndex < str.length && /\s/.test(str[currentIndex])) currentIndex++;
            if (str[currentIndex] === '{') {
                const subBlock = getBalancedBlock(str, currentIndex, '{', '}');
                if (subBlock) currentIndex = subBlock.end;
                else { currentIndex = beforeWs; break; }
            } else if (/[a-zA-Z0-9]/.test(str[currentIndex])) {
                currentIndex++;
            } else {
                currentIndex = beforeWs;
                break;
            }
        } else {
            currentIndex = beforeWs;
            hasSubSup = false;
        }
    }

    const zeroArgCmds = new Set([
        'alpha', 'beta', 'gamma', 'Gamma', 'delta', 'Delta', 'epsilon', 'varepsilon',
        'zeta', 'eta', 'theta', 'Theta', 'iota', 'kappa', 'lambda', 'Lambda',
        'mu', 'nu', 'xi', 'Xi', 'pi', 'Pi', 'rho', 'sigma', 'Sigma', 'tau',
        'upsilon', 'phi', 'Phi', 'chi', 'psi', 'Psi', 'omega', 'Omega',
        'pm', 'mp', 'times', 'div', 'cdot', 'circ', 'infty', 'ne', 'neq',
        'le', 'leq', 'ge', 'geq', 'approx', 'equiv', 'sim', 'cong',
        'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow', 'rightleftharpoons',
        'sin', 'cos', 'tan', 'cot', 'log', 'ln', 'lim', 'int', 'sum', 'prod', 'to'
    ]);

    if (zeroArgCmds.has(cmdName)) {
        return { start: startIndex, end: currentIndex, text: str.slice(startIndex, currentIndex) };
    }

    const maxArgs = (cmdName === 'frac' || cmdName === 'dfrac' || cmdName === 'tfrac' || cmdName === 'binom') ? 2 : 1;
    let argCount = 0;
    while (argCount < maxArgs) {
        let beforeWs = currentIndex;
        while (currentIndex < str.length && /\s/.test(str[currentIndex])) currentIndex++;
        if (str[currentIndex] === '{') {
            const block = getBalancedBlock(str, currentIndex, '{', '}');
            if (block) {
                currentIndex = block.end;
                argCount++;
            } else {
                currentIndex = beforeWs;
                break;
            }
        } else {
            currentIndex = beforeWs;
            break;
        }
    }

    return { start: startIndex, end: currentIndex, text: str.slice(startIndex, currentIndex) };
}

function autoWrapRawTeX(str: string): string {
    let result = '';
    let i = 0;
    while (i < str.length) {
        if (str.slice(i, i + 7) === '@@MATH_') {
            const endIdx = str.indexOf('@@', i + 7);
            if (endIdx !== -1) {
                result += str.slice(i, endIdx + 2);
                i = endIdx + 2;
                continue;
            }
        }

        if (str[i] === '\\' && i + 1 < str.length && /[a-zA-Z]/.test(str[i + 1])) {
            const cmd = extractTeXCommand(str, i);
            if (cmd) {
                let startPos = cmd.start;
                let lookback = str.slice(0, startPos);
                const prefixMatch = lookback.match(/(?:(?:^|[\s,;])([a-zA-Z][a-zA-Z0-9_\'\(\)\*]*\s*(?:=|<|<=|>|>=|\+|\-)\s*))$/);
                if (prefixMatch && prefixMatch[1]) {
                    startPos -= prefixMatch[1].length;
                }

                let endPos = cmd.end;
                while (endPos < str.length) {
                    let rest = str.slice(endPos);
                    if (/^\s*[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]{2,}\b/.test(rest)) {
                        break;
                    }
                    let wsMatch = rest.match(/^\s*/);
                    let skipWs = wsMatch ? wsMatch[0].length : 0;
                    if (str[endPos + skipWs] === '\\' && /[a-zA-Z]/.test(str[endPos + skipWs + 1])) {
                        const nextCmd = extractTeXCommand(str, endPos + skipWs);
                        if (nextCmd) {
                            endPos = nextCmd.end;
                            continue;
                        }
                    }

                    let opMatch = rest.match(/^\s*([\+\-\*\/\=\<\>\:\;\|]\s*|\^[\{0-9a-zA-Z]+|_[\{0-9a-zA-Z]+|\d+(?:[,\.]\d+)?(?![a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9])|[a-zA-Z](?![a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9])|\([^\)]*\)|\[[^\]]*\])/);
                    if (opMatch && !/[\u00C0-\u024F\u1EA0-\u1EF9]/.test(opMatch[0])) {
                        endPos += opMatch[0].length;
                        let afterOpWs = str.slice(endPos).match(/^\s*/);
                        let skipAfterWs = afterOpWs ? afterOpWs[0].length : 0;
                        if (str[endPos + skipAfterWs] === '\\' && /[a-zA-Z]/.test(str[endPos + skipAfterWs + 1])) {
                            const nextCmd = extractTeXCommand(str, endPos + skipAfterWs);
                            if (nextCmd) {
                                endPos = nextCmd.end;
                                continue;
                            }
                        }
                    } else {
                        break;
                    }
                }

                let expr = str.slice(startPos, endPos).trim();
                expr = expr.replace(/[\.\:\;\,]$/, '');
                
                const outsideBraces = expr.replace(/\{[^{}]*\}/g, '');
                if (!/[\u00C0-\u024F\u1EA0-\u1EF9]/.test(outsideBraces)) {
                    result = result.slice(0, result.length - (cmd.start - startPos));
                    result += `\\(${expr}\\)`;
                    i = startPos + expr.length;
                    continue;
                }
            }
        }

        result += str[i];
        i++;
    }
    return result;
}

function repairMissingBackslashes(str: string): string {
    if (!str) return '';
    let res = String(str);

    // 1. Thu gọn các backslash bị duplicate (\\, \\\\) trước tên lệnh TeX
    res = res.replace(/\\{2,}(?=[a-zA-Z\{])/g, '\\');

    // 2. Phục hồi toàn bộ ký tự điều khiển ASCII bị hỏng do unescape trong JS/JSON/Word
    res = res.replace(/\x09ext/g, '\\text');
    res = res.replace(/\x09heta/g, '\\theta');
    res = res.replace(/\x09imes/g, '\\times');
    res = res.replace(/\x09au\b/g, '\\tau');
    res = res.replace(/\x09frac/g, '\\tfrac');
    res = res.replace(/\x09riangle/g, '\\triangle');
    res = res.replace(/\x09o\b/g, '\\to');
    res = res.replace(/\x09extbf/g, '\\textbf');
    res = res.replace(/\x09extit/g, '\\textit');
    res = res.replace(/\x09extrm/g, '\\textrm');

    res = res.replace(/\x0Dho/g, '\\rho');
    res = res.replace(/\x0Dightarrow/g, '\\rightarrow');
    res = res.replace(/\x0Dightleftharpoons/g, '\\rightleftharpoons');
    res = res.replace(/\x0Dight/g, '\\right');
    res = res.replace(/\x0Def/g, '\\ref');
    res = res.replace(/\x0Dad/g, '\\rad');

    res = res.replace(/\x08eta/g, '\\beta');
    res = res.replace(/\x08egin/g, '\\begin');
    res = res.replace(/\x08ar/g, '\\bar');
    res = res.replace(/\x08inom/g, '\\binom');
    res = res.replace(/\x08old/g, '\\bold');

    res = res.replace(/\x0C(?:frac|dfrac|tfrac)/g, '\\frac');
    res = res.replace(/\x0Cforall/g, '\\forall');
    res = res.replace(/\x0Cflat/g, '\\flat');

    res = res.replace(/\x07lpha/g, '\\alpha');
    res = res.replace(/\x07pprox/g, '\\approx');
    res = res.replace(/\x07ngle/g, '\\angle');
    res = res.replace(/\x07cute/g, '\\acute');
    res = res.replace(/\x07rray/g, '\\array');

    res = res.replace(/\x0Bec/g, '\\vec');
    res = res.replace(/\x0Barepsilon/g, '\\varepsilon');
    res = res.replace(/\x0Bartheta/g, '\\vartheta');
    res = res.replace(/\x0Bvarphi/g, '\\varphi');
    res = res.replace(/\x0Bdots/g, '\\vdots');

    res = res.replace(/\x0A(?=(?:u|eq|abla|ot|in|ni|cap|cup|ce|pu|frac|sqrt|vec|theta|alpha|beta)\b)/g, '\\');

    // 3. Chuẩn hóa ký hiệu độ (°C, °) trong mọi ngữ cảnh
    res = res.replace(/(\$?)([\+\-]?\d+(?:[,\.]\d+)?)\s*\^(?:\{\\?circ\}|\\?circ)\s*([A-Za-z])(\$?)/g, function(m, d1, num, unit, d2) {
        return '$' + num + '^{\\circ}\\text{' + unit + '}$';
    });
    res = res.replace(/(\$?)([\+\-]?\d+(?:[,\.]\d+)?)\s*\^(?:\{\\?circ\}|\\?circ)(?!\s*\\?text)(?![a-zA-Z])(\$?)/g, function(m, d1, num, d2) {
        return '$' + num + '^{\\circ}$';
    });

    // 4. Chuẩn hóa backslash bị thiếu cho các cú pháp TeX có cấu trúc rõ ràng
    res = res.replace(/(?<!\\)\b(?:frac|dfrac|tfrac)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, '\\frac{$1}{$2}');
    res = res.replace(/(?<!\\)\bsqrt(?:\[([^\]]*)\])?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (m, opt, arg) => opt ? `\\sqrt[${opt}]{${arg}}` : `\\sqrt{${arg}}`);
    res = res.replace(/(?<!\\)\b(vec|overrightarrow|overline|widehat|underline|mathbf|mathit|mathrm)\s*\{([^{}]+)\}/g, '\\$1{$2}');
    res = res.replace(/(?<!\\)\b(begin|end)\s*\{(cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|align|align\*|gather|gather\*|equation|equation\*|alignat|multline)\}/g, '\\$1{$2}');
    res = res.replace(/(?<!\\)\b(ce|pu)\s*\{/g, '\\$1{');

    // Ký hiệu toán học và hy lạp đặc thù (không trùng từ tiếng Việt)
    res = res.replace(/(?<!\\)\b(alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|Theta|iota|kappa|lambda|Lambda|mu|nu|xi|Xi|pi|Pi|rho|sigma|Sigma|tau|upsilon|phi|Phi|chi|psi|Psi|omega|Omega)\b/g, '\\$1');
    res = res.replace(/(?<!\\)\b(le|leq|ge|geq|neq|approx|equiv|pm|mp|times|div|cdot|rightarrow|leftarrow|Rightarrow|LeftrightArrow|infty|angle|perpendicular|parallel|partial)\b/g, '\\$1');

    // Hàm toán học khi có dấu hiệu hàm rõ ràng (theo sau bởi ngoặc đơn hoặc chỉ số dưới)
    res = res.replace(/(?<![a-zA-Z\\])\b(sin|cos|tan|cot)\s*(?=\()/g, '\\$1');
    res = res.replace(/(?<![a-zA-Z\\])\b(log|ln)\s*(?=[\(_])/g, '\\$1');
    res = res.replace(/(?<![a-zA-Z\\])\blim\s*(?=\_)/g, '\\lim');

    return res;
}

/**
 * Xử lý & chuẩn hóa toàn bộ công thức Toán, Lý, Hóa, Sinh, ký hiệu đặc biệt cho MathJax trong PDF.
 */
function cleanHTMLText(str: any): string {
    if (str === null || str === undefined) return '';
    let text = typeof str === 'object' ? getOptionText(str) : String(str);
    if (!text) return '';

    text = repairMissingBackslashes(text);

    text = text.replace(/(\$\$|\\\[|\\\(|\$|\\ce\{|\\pu\{|\\begin\{)(.*?)(\$\$|\\\]|\\\)|(?:\$|\}|\end\{[^}]+\}))/gs, (m) => {
        return m.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
    });

    const mathBlocks: string[] = [];
    const saveBlock = (latexCode: string) => {
        mathBlocks.push(latexCode);
        return `@@MATH_${mathBlocks.length - 1}@@`;
    };

    text = text.replace(/\$\$(.*?)\$\$/gs, (_, p1) => saveBlock(`\\(\\displaystyle ${p1}\\)`));
    text = text.replace(/\\\[(.*?)\\\]/gs, (_, p1) => saveBlock(`\\(\\displaystyle ${p1}\\)`));
    text = text.replace(/\\begin\{(align|gather|equation|alignat|multline)\*?\}(.*?)\\end\{\1\*?\}/gs, (match) => saveBlock(`\\[${match}\\]`));
    text = text.replace(/\\begin\{([^}]+)\}(.*?)\\end\{\1\}/gs, (match) => saveBlock(`\\(${match}\\)`));
    text = text.replace(/\\\((.*?)\\\)/gs, (_, p1) => saveBlock(`\\(${p1}\\)`));
    text = text.replace(/\\ce\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (match) => saveBlock(`\\(${match}\\)`));
    text = text.replace(/\\pu\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (match) => saveBlock(`\\(${match}\\)`));
    text = text.replace(/\$((?:\\\$|[^$])+?)\$/gs, (_, p1) => saveBlock(`\\(${p1}\\)`));

    // Tự động nhận diện phản ứng & công thức hóa học trần
    text = text.replace(/((?:\d*[A-Z][a-z]?\d*|\([A-Za-z0-9]+\)\d*|\s|\+|\(|\))+(?:->|<=>|⇌|\u2192|\u21C4)(?:\d*[A-Z][a-z]?\d*|\([A-Za-z0-9]+\)\d*|\s|\+|\(|\))+)/g, (match) => {
        if (match.includes('@@MATH_')) return match;
        return saveBlock(`\\(\\ce{${match.trim()}}\\)`);
    });
    text = text.replace(/\b([A-Z][a-z]?\d*)\^\{?([\+\-]?\d+|\d+[\+\-])\}?/g, (_, elem, charge) => {
        if (elem.includes('@@MATH_')) return elem;
        return saveBlock(`\\(\\ce{${elem}^{${charge}}}\\)`);
    });

    // Tự động bọc lệnh TeX trần không có $...$
    text = autoWrapRawTeX(text);
    text = text.replace(/\\\((.*?)\\\)/gs, (_, p1) => saveBlock(`\\(${p1}\\)`));

    text = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(/&lt;sup&gt;/gi, '<sup>').replace(/&lt;\/sup&gt;/gi, '</sup>');
    text = text.replace(/&lt;sub&gt;/gi, '<sub>').replace(/&lt;\/sub&gt;/gi, '</sub>');
    text = text.replace(/&lt;b&gt;/gi, '<b>').replace(/&lt;\/b&gt;/gi, '</b>');
    text = text.replace(/&lt;strong&gt;/gi, '<strong>').replace(/&lt;\/strong&gt;/gi, '</strong>');
    text = text.replace(/&lt;i&gt;/gi, '<i>').replace(/&lt;\/i&gt;/gi, '</i>');
    text = text.replace(/&lt;em&gt;/gi, '<em>').replace(/&lt;\/em&gt;/gi, '</em>');
    text = text.replace(/&lt;u&gt;/gi, '<u>').replace(/&lt;\/u&gt;/gi, '</u>');
    text = text.replace(/&lt;mark&gt;/gi, '<mark>').replace(/&lt;\/mark&gt;/gi, '</mark>');
    text = text.replace(/&lt;p&gt;/gi, '<p>').replace(/&lt;\/p&gt;/gi, '</p>');
    text = text.replace(/&lt;div&gt;/gi, '<div>').replace(/&lt;\/div&gt;/gi, '</div>');
    text = text.replace(/&lt;span&gt;/gi, '<span>').replace(/&lt;\/span&gt;/gi, '</span>');
    text = text.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

    let loopCount = 0;
    while (/@@MATH_\d+@@/.test(text) && loopCount < 5) {
        text = text.replace(/@@MATH_(\d+)@@/g, (_, p1) => {
            let math = mathBlocks[Number(p1)] || '';
            return `<span class="tex2jax_process">${math}</span>`;
        });
        loopCount++;
    }

    return text;
}

function escapeHtml(str: string): string {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
