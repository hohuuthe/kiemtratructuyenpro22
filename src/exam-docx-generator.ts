import {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType, PageNumber, BorderStyle, UnderlineType,
    ImageRun, Footer
} from 'docx';

export interface ExamExportHeaderOptions {
    soGiaoDuc?: string;
    truongHoc?: string;
    deThiTitle?: string;
    namHoc?: string;
    monHoc?: string;
    thoiGian?: number | string;
    maDe?: string;
    pageCountEstimate?: string | number;
}

export interface ExamExportQuestion {
    id?: string | number;
    type: '4-1' | 'TF4' | 'SQ' | 'TL' | string;
    level?: string;
    lesson?: string;
    content: string;
    options?: Record<string, string> | any;
    answer?: string;
    image?: string;
}

/**
 * Safely extracts plain text string from option value which can be string, object ({text: "..."}, {content: "..."}), or number.
 */
export function getOptionText(optValue: any): string {
    if (optValue === null || optValue === undefined) return '';
    if (typeof optValue === 'string') return optValue;
    if (typeof optValue === 'number') return String(optValue);
    if (typeof optValue === 'object') {
        if (typeof optValue.text === 'string') return optValue.text;
        if (typeof optValue.content === 'string') return optValue.content;
        if (typeof optValue.value === 'string') return optValue.value;
        if (typeof optValue.label === 'string') return optValue.label;
        for (const k of Object.keys(optValue)) {
            if (typeof optValue[k] === 'string' && k !== 'image' && k !== 'answerImage') {
                return optValue[k];
            }
        }
    }
    return String(optValue || '');
}

/**
 * Parses simple HTML / formatting tags (<sup>, <sub>, <b>, <i>, math markers) into docx TextRun array.
 */
export function parseFormattedText(textInput: any, defaultBold = false): TextRun[] {
    if (textInput === null || textInput === undefined) return [];
    let text = textInput;
    if (typeof text === 'object') {
        text = getOptionText(text);
    }
    let str = String(text || '');

    // Chuyển đổi các công thức & ký hiệu LaTeX phổ biến sang dạng Unicode/HTML tiêu chuẩn cho Word
    str = str
        .replace(/\\(?:ce|pu)\{(.*?)\}/g, '$1')
        .replace(/\\degree\b/g, '°')
        .replace(/\\\^\s*\{\s*\\circ\s*\}/g, '°')
        .replace(/\^\s*\{\s*\\circ\s*\}/g, '°')
        .replace(/\\\^\s*\\circ/g, '°')
        .replace(/\^\s*\\circ/g, '°')
        .replace(/\{\\circ\}/g, '°')
        .replace(/\\alpha\b/g, 'α')
        .replace(/\\beta\b/g, 'β')
        .replace(/\\gamma\b/g, 'γ')
        .replace(/\\Gamma\b/g, 'Γ')
        .replace(/\\delta\b/g, 'δ')
        .replace(/\\Delta\b/g, 'Δ')
        .replace(/\\epsilon\b|\\varepsilon\b/g, 'ε')
        .replace(/\\theta\b|\\Theta\b/g, 'θ')
        .replace(/\\lambda\b/g, 'λ')
        .replace(/\\Lambda\b/g, 'Λ')
        .replace(/\\mu\b/g, 'μ')
        .replace(/\\pi\b/g, 'π')
        .replace(/\\Pi\b/g, 'Π')
        .replace(/\\rho\b/g, 'ρ')
        .replace(/\\sigma\b/g, 'σ')
        .replace(/\\Sigma\b/g, 'Σ')
        .replace(/\\tau\b/g, 'τ')
        .replace(/\\phi\b|\\Phi\b/g, 'φ')
        .replace(/\\omega\b/g, 'ω')
        .replace(/\\Omega\b/g, 'Ω')
        .replace(/\\le\b|\\leq\b/g, '≤')
        .replace(/\\ge\b|\\geq\b/g, '≥')
        .replace(/\\neq\b/g, '≠')
        .replace(/\\approx\b/g, '≈')
        .replace(/\\equiv\b/g, '≡')
        .replace(/\\infty\b/g, '∞')
        .replace(/\\pm\b/g, '±')
        .replace(/\\mp\b/g, '∓')
        .replace(/\\times\b/g, '×')
        .replace(/\\div\b/g, '÷')
        .replace(/\\cdot\b/g, '·')
        .replace(/\\rightarrow\b|\\to\b/g, '→')
        .replace(/\\leftarrow\b/g, '←')
        .replace(/\\Rightarrow\b/g, '⇒')
        .replace(/\\Leftrightarrow\b/g, '⇔')
        .replace(/\\angle\b/g, '∠')
        .replace(/\\perpendicular\b|\\bot\b/g, '⊥')
        .replace(/\\parallel\b/g, '∥')
        .replace(/\\in\b/g, '∈')
        .replace(/\\notin\b/g, '∉')
        .replace(/\\subset\b/g, '⊂')
        .replace(/\\subseteq\b/g, '⊆')
        .replace(/\\cup\b/g, '∪')
        .replace(/\\cap\b/g, '∩')
        .replace(/\\forall\b/g, '∀')
        .replace(/\\exists\b/g, '∃')
        .replace(/\\(?:frac|dfrac|tfrac)\{([^{}]+)\}\{([^{}]+)\}/g, '($1/$2)')
        .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
        .replace(/\\(?:vec|overrightarrow)\{([^{}]+)\}/g, 'véc($1)')
        .replace(/\\text\{([^{}]+)\}/g, '$1')
        .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
        .replace(/\\mathbf\{([^{}]+)\}/g, '$1')
        .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
        .replace(/\_\{([^{}]+)\}/g, '<sub>$1</sub>');

    // Làm sạch markers MathJax nhưng vẫn giữ công thức đọc dễ dàng
    str = str.replace(/\\\((.*?)\\\)/gs, '$1')
             .replace(/\\\[(.*?)\\\]/gs, '$1')
             .replace(/\$\$(.*?)\$\$/gs, '$1')
             .replace(/\$(.*?)\$/gs, '$1');

    // Tokenize tags: <b>, </b>, <i>, </i>, <sup>, </sup>, <sub>, </sub>, <br>, <br/>, &lt;, &gt;, &amp;
    const tokens = str.split(/(<[^>]+>)/g);
    const runs: TextRun[] = [];

    let isBold = defaultBold;
    let isItalic = false;
    let isSuper = false;
    let isSub = false;

    for (const token of tokens) {
        if (!token) continue;
        const lower = token.toLowerCase();

        if (lower === '<b>' || lower === '<strong>') {
            isBold = true;
        } else if (lower === '</b>' || lower === '</strong>') {
            isBold = defaultBold;
        } else if (lower === '<i>' || lower === '<em>') {
            isItalic = true;
        } else if (lower === '</i>' || lower === '</em>') {
            isItalic = false;
        } else if (lower === '<sup>') {
            isSuper = true;
        } else if (lower === '</sup>') {
            isSuper = false;
        } else if (lower === '<sub>') {
            isSub = true;
        } else if (lower === '</sub>') {
            isSub = false;
        } else if (lower === '<br>' || lower === '<br/>' || lower === '<br />') {
            runs.push(new TextRun({
                text: "\n",
                font: "Times New Roman",
                size: 26
            }));
        } else if (token.startsWith('<') && token.endsWith('>')) {
            // Other HTML tag, ignore
        } else {
            // Normal text content
            let clean = token
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'")
                .replace(/&nbsp;/g, ' ');

            if (clean.length > 0) {
                runs.push(new TextRun({
                    text: clean,
                    font: "Times New Roman",
                    size: 26, // 13pt
                    bold: isBold,
                    italics: isItalic,
                    superScript: isSuper,
                    subScript: isSub
                }));
            }
        }
    }

    if (runs.length === 0) {
        runs.push(new TextRun({
            text: "",
            font: "Times New Roman",
            size: 26,
            bold: defaultBold
        }));
    }

    return runs;
}

/**
 * Helper to safely extract A, B, C, D options from any structure (object, array, nested text/content)
 * as well as option image URLs if available.
 */
export function extractOptionsABCD(opts: any, q?: any): {
    optA: string; optB: string; optC: string; optD: string;
    imgA?: string; imgB?: string; imgC?: string; imgD?: string;
} {
    if (!opts) return { optA: '', optB: '', optC: '', optD: '' };
    let parsedOpts = opts;
    if (typeof parsedOpts === 'string') {
        try { parsedOpts = JSON.parse(parsedOpts); } catch (e) { parsedOpts = {}; }
    }

    const extractImg = (val: any, keyName?: string): string | undefined => {
        if (val && typeof val === 'object') {
            if (typeof val.image === 'string' && val.image) return val.image;
            if (typeof val.img === 'string' && val.img) return val.img;
            if (typeof val.src === 'string' && val.src) return val.src;
            if (typeof val.url === 'string' && val.url) return val.url;
            if (typeof val.picture === 'string' && val.picture) return val.picture;
        }
        if (keyName && q) {
            if (q.optionImages && q.optionImages[keyName]) return q.optionImages[keyName];
            if (q.images && q.images[keyName]) return q.images[keyName];
        }
        return undefined;
    };

    if (Array.isArray(parsedOpts)) {
        return {
            optA: getOptionText(parsedOpts[0]),
            optB: getOptionText(parsedOpts[1]),
            optC: getOptionText(parsedOpts[2]),
            optD: getOptionText(parsedOpts[3]),
            imgA: extractImg(parsedOpts[0], 'A'),
            imgB: extractImg(parsedOpts[1], 'B'),
            imgC: extractImg(parsedOpts[2], 'C'),
            imgD: extractImg(parsedOpts[3], 'D')
        };
    }
    if (typeof parsedOpts === 'object' && parsedOpts !== null) {
        const getVal = (...keys: string[]) => {
            for (const k of keys) {
                if (parsedOpts[k] !== undefined && parsedOpts[k] !== null) {
                    const txt = getOptionText(parsedOpts[k]);
                    if (txt && txt.trim().length > 0) return txt;
                }
            }
            return '';
        };

        const getObj = (...keys: string[]) => {
            for (const k of keys) {
                if (parsedOpts[k] !== undefined && parsedOpts[k] !== null) {
                    return parsedOpts[k];
                }
            }
            return undefined;
        };

        const objA = getObj('A', 'a', '0', '1', 'optA', 'optionA', 'opt_a');
        const objB = getObj('B', 'b', '1', '2', 'optB', 'optionB', 'opt_b');
        const objC = getObj('C', 'c', '2', '3', 'optC', 'optionC', 'opt_c');
        const objD = getObj('D', 'd', '3', '4', 'optD', 'optionD', 'opt_d');

        const optA = getVal('A', 'a', '0', '1', 'optA', 'optionA', 'opt_a', 'first');
        const optB = getVal('B', 'b', '1', '2', 'optB', 'optionB', 'opt_b', 'second');
        const optC = getVal('C', 'c', '2', '3', 'optC', 'optionC', 'opt_c', 'third');
        const optD = getVal('D', 'd', '3', '4', 'optD', 'optionD', 'opt_d', 'fourth');

        return {
            optA, optB, optC, optD,
            imgA: extractImg(objA, 'A'),
            imgB: extractImg(objB, 'B'),
            imgC: extractImg(objC, 'C'),
            imgD: extractImg(objD, 'D')
        };
    }
    return { optA: '', optB: '', optC: '', optD: '' };
}

/**
 * Helper to build borderless Table for 4 options (A, B, C, D) or 4 true/false sub-items (a, b, c, d).
 * Guarantees perfect column alignment across all questions using Word tables without borders.
 */
export function buildOptionsTable(
    labels: [string, string, string, string],
    texts: [string, string, string, string],
    noBordersObj: any
): Table | Paragraph[] {
    const [lblA, lblB, lblC, lblD] = labels;
    const [optA, optB, optC, optD] = texts;

    const hasAnyOption = Boolean(optA.trim() || optB.trim() || optC.trim() || optD.trim());
    if (!hasAnyOption) {
        return [];
    }

    const lenA = String(optA).length;
    const lenB = String(optB).length;
    const lenC = String(optC).length;
    const lenD = String(optD).length;
    const maxLen = Math.max(lenA, lenB, lenC, lenD);
    const sumLen = lenA + lenB + lenC + lenD;

    // Case 1: Short options on 1 row (4 columns, 25% width each)
    if (maxLen <= 12 && sumLen <= 48) {
        return new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBordersObj,
            rows: [
                new TableRow({
                    cantSplit: true,
                    children: [
                        new TableCell({
                            width: { size: 25, type: WidthType.PERCENTAGE },
                            borders: noBordersObj,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.LEFT,
                                    spacing: { before: 20, after: 30, line: 276 },
                                    children: [
                                        new TextRun({ text: lblA, font: "Times New Roman", size: 26, bold: true }),
                                        ...parseFormattedText(optA)
                                    ]
                                })
                            ]
                        }),
                        new TableCell({
                            width: { size: 25, type: WidthType.PERCENTAGE },
                            borders: noBordersObj,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.LEFT,
                                    spacing: { before: 20, after: 30, line: 276 },
                                    children: [
                                        new TextRun({ text: lblB, font: "Times New Roman", size: 26, bold: true }),
                                        ...parseFormattedText(optB)
                                    ]
                                })
                            ]
                        }),
                        new TableCell({
                            width: { size: 25, type: WidthType.PERCENTAGE },
                            borders: noBordersObj,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.LEFT,
                                    spacing: { before: 20, after: 30, line: 276 },
                                    children: [
                                        new TextRun({ text: lblC, font: "Times New Roman", size: 26, bold: true }),
                                        ...parseFormattedText(optC)
                                    ]
                                })
                            ]
                        }),
                        new TableCell({
                            width: { size: 25, type: WidthType.PERCENTAGE },
                            borders: noBordersObj,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.LEFT,
                                    spacing: { before: 20, after: 30, line: 276 },
                                    children: [
                                        new TextRun({ text: lblD, font: "Times New Roman", size: 26, bold: true }),
                                        ...parseFormattedText(optD)
                                    ]
                                })
                            ]
                        })
                    ]
                })
            ]
        });
    }

    // Case 2: Medium options on 2 rows (2 columns, 50% width each)
    if (maxLen <= 38) {
        return new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBordersObj,
            rows: [
                new TableRow({
                    cantSplit: true,
                    children: [
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: noBordersObj,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.LEFT,
                                    spacing: { before: 20, after: 20, line: 276 },
                                    children: [
                                        new TextRun({ text: lblA, font: "Times New Roman", size: 26, bold: true }),
                                        ...parseFormattedText(optA)
                                    ]
                                })
                            ]
                        }),
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: noBordersObj,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.LEFT,
                                    spacing: { before: 20, after: 20, line: 276 },
                                    children: [
                                        new TextRun({ text: lblB, font: "Times New Roman", size: 26, bold: true }),
                                        ...parseFormattedText(optB)
                                    ]
                                })
                            ]
                        })
                    ]
                }),
                new TableRow({
                    cantSplit: true,
                    children: [
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: noBordersObj,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.LEFT,
                                    spacing: { before: 20, after: 30, line: 276 },
                                    children: [
                                        new TextRun({ text: lblC, font: "Times New Roman", size: 26, bold: true }),
                                        ...parseFormattedText(optC)
                                    ]
                                })
                            ]
                        }),
                        new TableCell({
                            width: { size: 50, type: WidthType.PERCENTAGE },
                            borders: noBordersObj,
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.LEFT,
                                    spacing: { before: 20, after: 30, line: 276 },
                                    children: [
                                        new TextRun({ text: lblD, font: "Times New Roman", size: 26, bold: true }),
                                        ...parseFormattedText(optD)
                                    ]
                                })
                            ]
                        })
                    ]
                })
            ]
        });
    }

    // Case 3: Long options (> 38 chars) -> 4 separate paragraphs
    return [
        new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 20, after: 20, line: 276 },
            children: [
                new TextRun({ text: lblA, font: "Times New Roman", size: 26, bold: true }),
                ...parseFormattedText(optA)
            ]
        }),
        new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 20, after: 20, line: 276 },
            children: [
                new TextRun({ text: lblB, font: "Times New Roman", size: 26, bold: true }),
                ...parseFormattedText(optB)
            ]
        }),
        new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 20, after: 20, line: 276 },
            children: [
                new TextRun({ text: lblC, font: "Times New Roman", size: 26, bold: true }),
                ...parseFormattedText(optC)
            ]
        }),
        new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 20, after: 30, line: 276 },
            children: [
                new TextRun({ text: lblD, font: "Times New Roman", size: 26, bold: true }),
                ...parseFormattedText(optD)
            ]
        })
    ];
}

/**
 * Helper to fetch image bytes from URL or base64 (compatible with both Node.js and Browser/Cloudflare Pages)
 */
export async function fetchImageBuffer(imageUrl: string): Promise<Uint8Array | null> {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    try {
        const trimmed = imageUrl.trim();
        if (trimmed.startsWith('data:image')) {
            const parts = trimmed.split(',');
            if (parts.length > 1) {
                const base64Str = parts[1];
                if (typeof window !== 'undefined' && typeof window.atob === 'function') {
                    const binaryStr = window.atob(base64Str);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                        bytes[i] = binaryStr.charCodeAt(i);
                    }
                    return bytes;
                } else if (typeof Buffer !== 'undefined') {
                    return new Uint8Array(Buffer.from(base64Str, 'base64'));
                }
            }
            return null;
        }

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 3500) : null;
        
        const res = await fetch(trimmed, {
            signal: controller ? controller.signal : undefined
        }).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });

        if (!res.ok) return null;
        const arrayBuffer = await res.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength < 10) return null;
        return new Uint8Array(arrayBuffer);
    } catch {
        return null;
    }
}

/**
 * Estimates total page count based on question types and content length.
 */
export function estimatePageCount(questions: ExamExportQuestion[]): number {
    if (!questions || questions.length === 0) return 1;
    let weight = 0;
    for (const q of questions) {
        if (q.type === '4-1') weight += 1.1;
        else if (q.type === 'TF4') weight += 2.2;
        else if (q.type === 'SQ') weight += 1.3;
        else if (q.type === 'TL') weight += 2.5;
        else weight += 1.2;
        if (q.image) weight += 1.8;
    }
    const totalWeight = weight + 2;
    const pages = Math.ceil(totalWeight / 12);
    return Math.max(1, pages);
}

/**
 * Main function to generate the Word (.docx) file matching the user's template.
 */
export async function generateExamDocx(
    headerOptions: ExamExportHeaderOptions,
    questions: ExamExportQuestion[]
): Promise<Buffer> {
    const {
        soGiaoDuc = "SỞ GIÁO DỤC VÀ ĐÀO TẠO GIA LAI",
        truongHoc = "TRƯỜNG THPT LÊ HOÀN",
        deThiTitle = "ĐỀ KIỂM TRA GIỮA HKII",
        namHoc = "NĂM HỌC 2026 - 2027",
        monHoc = "MÔN TIN HỌC, LỚP 12",
        thoiGian = 45,
        maDe = "1201",
        pageCountEstimate
    } = headerOptions;

    const pageCount = pageCountEstimate || estimatePageCount(questions);
    const pageCountText = `(Đề thi có ${pageCount} trang)`;

    const noBorders = {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    };

    const singleBlackBorder = {
        top: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
        bottom: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
        left: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
        right: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
    };

    // 1. Header Table
    const headerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders,
        rows: [
            new TableRow({
                cantSplit: true,
                children: [
                    new TableCell({
                        width: { size: 45, type: WidthType.PERCENTAGE },
                        borders: noBorders,
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 30, line: 240 },
                                children: [
                                    new TextRun({
                                        text: soGiaoDuc.toUpperCase(),
                                        font: "Times New Roman",
                                        size: 24, // 12pt
                                        bold: false
                                    })
                                ]
                            }),
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 80, line: 240 },
                                children: [
                                    new TextRun({
                                        text: truongHoc.toUpperCase(),
                                        font: "Times New Roman",
                                        size: 24, // 12pt
                                        bold: true,
                                        underline: { type: UnderlineType.SINGLE }
                                    })
                                ]
                            }),
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { before: 60, after: 40, line: 240 },
                                children: [
                                    new TextRun({
                                        text: pageCountText,
                                        font: "Times New Roman",
                                        size: 24,
                                        italics: true
                                    })
                                ]
                            })
                        ]
                    }),
                    new TableCell({
                        width: { size: 55, type: WidthType.PERCENTAGE },
                        borders: noBorders,
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 30, line: 240 },
                                children: [
                                    new TextRun({
                                        text: deThiTitle.toUpperCase(),
                                        font: "Times New Roman",
                                        size: 26, // 13pt
                                        bold: true
                                    })
                                ]
                            }),
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 30, line: 240 },
                                children: [
                                    new TextRun({
                                        text: namHoc.toUpperCase(),
                                        font: "Times New Roman",
                                        size: 26,
                                        bold: true
                                    })
                                ]
                            }),
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { after: 80, line: 240 },
                                children: [
                                    new TextRun({
                                        text: monHoc.toUpperCase(),
                                        font: "Times New Roman",
                                        size: 26,
                                        bold: true
                                    })
                                ]
                            }),
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { before: 60, after: 40, line: 240 },
                                children: [
                                    new TextRun({
                                        text: `Thời gian làm bài: ${thoiGian} phút, không kể thời gian phát đề`,
                                        font: "Times New Roman",
                                        size: 24,
                                        italics: true
                                    })
                                ]
                            })
                        ]
                    })
                ]
            })
        ]
    });

    // 2. Student Info & Ma De Box
    const studentInfoTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders,
        rows: [
            new TableRow({
                cantSplit: true,
                children: [
                    new TableCell({
                        width: { size: 78, type: WidthType.PERCENTAGE },
                        borders: noBorders,
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.LEFT,
                                spacing: { before: 80, after: 80, line: 276 },
                                children: [
                                    new TextRun({
                                        text: "Họ tên học sinh: .................................... Số báo danh: ...............",
                                        font: "Times New Roman",
                                        size: 26,
                                        bold: true
                                    })
                                ]
                            })
                        ]
                    }),
                    new TableCell({
                        width: { size: 22, type: WidthType.PERCENTAGE },
                        borders: singleBlackBorder,
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { before: 40, after: 40, line: 240 },
                                children: [
                                    new TextRun({
                                        text: `Mã đề ${maDe}`,
                                        font: "Times New Roman",
                                        size: 26,
                                        bold: true
                                    })
                                ]
                            })
                        ]
                    })
                ]
            })
        ]
    });

    // Classify questions into Parts
    const q41 = questions.filter(q => q.type === '4-1');
    const qTF4 = questions.filter(q => q.type === 'TF4');
    const qSQ = questions.filter(q => q.type === 'SQ');
    const qTL = questions.filter(q => q.type === 'TL');

    const bodyChildren: any[] = [
        headerTable,
        new Paragraph({ spacing: { before: 40, after: 40 }, children: [] }),
        studentInfoTable,
        new Paragraph({ spacing: { before: 60, after: 60 }, children: [] })
    ];

    // --- PHẦN I. CÂU TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN ---
    if (q41.length > 0) {
        bodyChildren.push(
            new Paragraph({
                alignment: AlignmentType.JUSTIFIED,
                spacing: { before: 100, after: 80, line: 276 },
                children: [
                    new TextRun({
                        text: `PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn. Thí sinh trả lời từ câu 1 đến câu ${q41.length}. Mỗi câu hỏi thí sinh chỉ chọn một phương án.`,
                        font: "Times New Roman",
                        size: 26,
                        bold: true
                    })
                ]
            })
        );

        for (let i = 0; i < q41.length; i++) {
            const q = q41[i];
            const qNum = i + 1;

            // Question text
            const qRuns = [
                new TextRun({
                    text: `Câu ${qNum}: `,
                    font: "Times New Roman",
                    size: 26,
                    bold: true
                }),
                ...parseFormattedText(q.content, false)
            ];

            bodyChildren.push(
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { before: 60, after: 40, line: 276 },
                    children: qRuns
                })
            );

            // If question has image
            if (q.image) {
                const imgBuf = await fetchImageBuffer(q.image);
                if (imgBuf) {
                    try {
                        bodyChildren.push(
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { before: 60, after: 60 },
                                children: [
                                    new ImageRun({
                                        data: imgBuf,
                                        transformation: { width: 320, height: 220 }
                                    })
                                ]
                            })
                        );
                    } catch (e) {
                        console.warn("Could not insert image for question", qNum, e);
                    }
                }
            }

            // Parse Options A, B, C, D
            const { optA, optB, optC, optD } = extractOptionsABCD(q.options);

            const optRes = buildOptionsTable([" A. ", " B. ", " C. ", " D. "], [optA, optB, optC, optD], noBorders);
            if (Array.isArray(optRes)) {
                bodyChildren.push(...optRes);
            } else {
                bodyChildren.push(optRes);
            }
        }
    }

    // --- PHẦN II. CÂU TRẮC NGHIỆM ĐÚNG SAI ---
    if (qTF4.length > 0) {
        bodyChildren.push(
            new Paragraph({
                alignment: AlignmentType.JUSTIFIED,
                spacing: { before: 120, after: 80, line: 276 },
                children: [
                    new TextRun({
                        text: `PHẦN II. Câu trắc nghiệm đúng sai (nếu có). Thí sinh trả lời từ câu 1 đến câu ${qTF4.length}. Trong mỗi ý a), b), c), d) ở mỗi câu, thí sinh chọn đúng hoặc sai.`,
                        font: "Times New Roman",
                        size: 26,
                        bold: true
                    })
                ]
            })
        );

        for (let i = 0; i < qTF4.length; i++) {
            const q = qTF4[i];
            const qNum = i + 1;

            bodyChildren.push(
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { before: 60, after: 40, line: 276 },
                    children: [
                        new TextRun({
                            text: `Câu ${qNum}: `,
                            font: "Times New Roman",
                            size: 26,
                            bold: true
                        }),
                        ...parseFormattedText(q.content, false)
                    ]
                })
            );

            if (q.image) {
                const imgBuf = await fetchImageBuffer(q.image);
                if (imgBuf) {
                    try {
                        bodyChildren.push(
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { before: 60, after: 60 },
                                children: [
                                    new ImageRun({
                                        data: imgBuf,
                                        transformation: { width: 320, height: 220 }
                                    })
                                ]
                            })
                        );
                    } catch (e) {}
                }
            }

            const { optA, optB, optC, optD } = extractOptionsABCD(q.options);

            const optRes = buildOptionsTable([" a) ", " b) ", " c) ", " d) "], [optA, optB, optC, optD], noBorders);
            if (Array.isArray(optRes)) {
                bodyChildren.push(...optRes);
            } else {
                bodyChildren.push(optRes);
            }
        }
    }

    // --- PHẦN III. CÂU TRẮC NGHIỆM TRẢ LỜI NGẮN / TỰ LUẬN ---
    const part3Questions = [...qSQ, ...qTL];
    if (part3Questions.length > 0) {
        const isEssay = qTL.length > 0;
        const part3Title = isEssay
            ? `PHẦN III. Tự luận (nếu có). Thí sinh trả lời từ câu 1 đến câu ${part3Questions.length}.`
            : `PHẦN III. Câu trắc nghiệm trả lời ngắn (nếu có). Thí sinh trả lời từ câu 1 đến câu ${part3Questions.length}.`;

        bodyChildren.push(
            new Paragraph({
                alignment: AlignmentType.JUSTIFIED,
                spacing: { before: 120, after: 80, line: 276 },
                children: [
                    new TextRun({
                        text: part3Title,
                        font: "Times New Roman",
                        size: 26,
                        bold: true
                    })
                ]
            })
        );

        for (let i = 0; i < part3Questions.length; i++) {
            const q = part3Questions[i];
            const qNum = i + 1;

            bodyChildren.push(
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { before: 60, after: 40, line: 276 },
                    children: [
                        new TextRun({
                            text: `Câu ${qNum}: `,
                            font: "Times New Roman",
                            size: 26,
                            bold: true
                        }),
                        ...parseFormattedText(q.content, false)
                    ]
                })
            );

            if (q.image) {
                const imgBuf = await fetchImageBuffer(q.image);
                if (imgBuf) {
                    try {
                        bodyChildren.push(
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { before: 60, after: 60 },
                                children: [
                                    new ImageRun({
                                        data: imgBuf,
                                        transformation: { width: 320, height: 220 }
                                    })
                                ]
                            })
                        );
                    } catch (e) {}
                }
            }

            // Dotted answer placeholder line
            bodyChildren.push(
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { before: 20, after: 60, line: 276 },
                    children: [
                        new TextRun({
                            text: "………………………………………………………………………………………………….",
                            font: "Times New Roman",
                            size: 26
                        })
                    ]
                })
            );
        }
    }

    // End of Exam
    bodyChildren.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 100 },
            children: [
                new TextRun({
                    text: "--- HẾT ---",
                    font: "Times New Roman",
                    size: 26,
                    bold: true
                })
            ]
        })
    );

    // Build Document with Exact Page Setup
    const doc = new Document({
        styles: {
            default: {
                document: {
                    run: {
                        font: "Times New Roman",
                        size: 26 // 13pt
                    },
                    paragraph: {
                        alignment: AlignmentType.JUSTIFIED,
                        spacing: { line: 276 }
                    }
                }
            }
        },
        sections: [{
            properties: {
                page: {
                    size: {
                        width: 11906,  // A4 Width: 210mm
                        height: 16838  // A4 Height: 297mm
                    },
                    margin: {
                        top: 1134,    // 2.0 cm (1134 dxa)
                        bottom: 1134, // 2.0 cm (1134 dxa)
                        left: 1134,   // 2.0 cm (1134 dxa)
                        right: 1134   // 2.0 cm (1134 dxa)
                    }
                }
            },
            footers: {
                default: new Footer({
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.RIGHT,
                            spacing: { line: 240 },
                            children: [
                                new TextRun({
                                    text: `Mã đề thi ${maDe} - Trang `,
                                    font: "Times New Roman",
                                    size: 26
                                }),
                                new TextRun({
                                    children: [PageNumber.CURRENT],
                                    font: "Times New Roman",
                                    size: 26
                                }),
                                new TextRun({
                                    text: " / ",
                                    font: "Times New Roman",
                                    size: 26
                                }),
                                new TextRun({
                                    children: [PageNumber.TOTAL_PAGES],
                                    font: "Times New Roman",
                                    size: 26
                                })
                            ]
                        })
                    ]
                })
            },
            children: bodyChildren
        }]
    });

    if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
        return (await Packer.toBlob(doc)) as any;
    }
    try {
        if (typeof Packer.toBuffer === 'function') {
            return await Packer.toBuffer(doc);
        }
    } catch (e) {}
    try {
        if (typeof Packer.toBlob === 'function') {
            return (await Packer.toBlob(doc)) as any;
        }
    } catch (e) {}
    return (await Packer.toUint8Array(doc)) as any;
}
