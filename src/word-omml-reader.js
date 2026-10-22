/**
 * Loss-aware Office Open XML Word importer.
 * Reads DOCX's original WordprocessingML / OMML structure, not flattened HTML.
 * Every Office Math object becomes a unique provenance token until validated.
 * Unsupported structures are kept in the review queue; never guessed.
 */
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export const WORD_IMPORT_ENGINE_VERSION = 'word-omml-1.0';
export const WORD_FORMULA_TOKEN = /__WMATH_[0-9]{6}__/g;
const MAX_DOCX_BYTES = 24 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 80 * 1024 * 1024;
const MAX_PART_BYTES = 25 * 1024 * 1024;
const MAX_PARTS = 1200;

const nameOf = node => node?.localName || node?.nodeName?.split(':').pop() || '';
const elements = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);
const child = (node, name) => elements(node).find(element => nameOf(element) === name);
const children = (node, name) => elements(node).filter(element => nameOf(element) === name);
const attr = (node, name) => {
    if (!node?.attributes) return null;
    for (let i = 0; i < node.attributes.length; i++) {
        const a = node.attributes.item(i);
        if (a && (a.name === name || nameOf(a) === name)) return a.value;
    }
    return null;
};
const descendants = (node, name) => {
    const result = [];
    for (const e of elements(node)) {
        if (nameOf(e) === name) result.push(e);
        result.push(...descendants(e, name));
    }
    return result;
};
const firstDesc = (node, name) => descendants(node, name)[0];
const textOf = node => String(node?.textContent || '');
const mathChildren = node => elements(node).filter(n => !['ctrlPr', 'rPr', 'argPr', 'sty', 'sPrePr', 'plcHide'].includes(nameOf(n)) && !nameOf(n).endsWith('Pr'));
const group = (node, tag) => {
    const v = child(node, tag);
    if (!v) throw new Error('Thiếu thành phần m:' + tag + ' trong Equation Word');
    return v;
};
const bs = String.fromCharCode(92);
const symbolTable = {
    '∞': '\\infty', '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∮': '\\oint',
    '√': '\\sqrt{}', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx',
    '×': '\\times', '÷': '\\div', '·': '\\cdot', '±': '\\pm', '∓': '\\mp',
    '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow',
    '∈': '\\in', '∉': '\\notin', '∩': '\\cap', '∪': '\\cup', '⊂': '\\subset',
    '⊆': '\\subseteq', '⊥': '\\perp', '∥': '\\parallel', '∠': '\\angle',
    '°': '^{\\circ}', '∂': '\\partial', '∇': '\\nabla', '∀': '\\forall',
    '∃': '\\exists', '∅': '\\emptyset',
    'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
    'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
    'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
    'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
    'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon',
    'φ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
    'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
    'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi',
    'Ψ': '\\Psi', 'Ω': '\\Omega'
};

const escapeMathRun = value => String(value).replace(/[\\{}%#$&_~^∞∑∏∫∮√≤≥≠≈×÷·±∓→←↔⇒∈∉∩∪⊂⊆⊥∥∠°∂∇∀∃∅α-ωΓΔΘΛΞΠΣΦΨΩ]/gu,
    char => symbolTable[char] || (char === bs ? '\\backslash ' :
        char === '{' ? '\\{' : char === '}' ? '\\}' :
        char === '^' ? '\\hat{}' : char === '_' ? '\\_' :
        char === '~' ? '\\sim ' : '\\' + char));
const delimiters = open => {
    const map = { '{': '\\{', '}': '\\}', '⟨': '\\langle', '⟩': '\\rangle', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil' };
    return open === '' ? '.' : map[open] || open || '.';
};
const mAttr = (node, prop, attribute, fallback) => {
    const p = child(node, prop);
    return attr(p ? child(p, attribute) : null, 'val') ?? fallback;
};
function omml(node, depth = 0) {
    if (!node) throw new Error('Thiếu phần tử Equation');
    if (depth > 70) throw new Error('Độ sâu công thức vượt giới hạn an toàn');
    const n = nameOf(node);
    const next = x => omml(x, depth + 1);
    const all = x => mathChildren(x).map(next).join('');
    const val = (parent, tag) => next(group(parent, tag));
    switch(n) {
        case 'oMath': case 'oMathPara': case 'e': case 'num': case 'den':
        case 'sub': case 'sup': case 'deg': case 'fName': case 'box':
            return all(node);
        case 'r': {
            const parts = children(node, 't');
            if (!parts.length) throw new Error('Ký hiệu trong Equation Word không có nội dung m:t');
            return escapeMathRun(parts.map(textOf).join(''));
        }
        case 't': return escapeMathRun(textOf(node));
        case 'f': return '\\frac{' + val(node, 'num') + '}{' + val(node, 'den') + '}';
        case 'sSup': return '{' + val(node, 'e') + '}^{' + val(node, 'sup') + '}';
        case 'sSub': return '{' + val(node, 'e') + '}_{' + val(node, 'sub') + '}';
        case 'sSubSup': return '{' + val(node, 'e') + '}_{' + val(node, 'sub') + '}^{' + val(node, 'sup') + '}';
        case 'rad': {
            const index = child(node, 'deg');
            const root = val(node, 'e');
            const deg = index ? next(index) : '';
            return deg ? '\\sqrt[' + deg + ']{' + root + '}' : '\\sqrt{' + root + '}';
        }
        case 'd': {
            const open = mAttr(node, 'dPr', 'begChr', '(');
            const close = mAttr(node, 'dPr', 'endChr', ')');
            const separator = mAttr(node, 'dPr', 'sepChr', ',');
            const values = children(node, 'e').map(next);
            if (!values.length) throw new Error('Dấu ngoặc Equation không có nội dung');
            return '\\left' + delimiters(open) + values.join(separator) + '\\right' + delimiters(close);
        }
        case 'm': {
            const rows = children(node, 'mr').map(row => children(row, 'e').map(next));
            if (!rows.length || rows.some(row => row.length !== rows[0].length)) {
                throw new Error('Ma trận Word thiếu hàng hoặc số cột không đồng đều');
            }
            return '\\begin{matrix}' + rows.map(row => row.join(' & ')).join(' \\\\ ') + '\\end{matrix}';
        }
        case 'eqArr': {
            const rows = children(node, 'e').map(next);
            if (!rows.length) throw new Error('Equation nhiều dòng trống');
            return '\\begin{aligned}' + rows.join(' \\\\ ') + '\\end{aligned}';
        }
        case 'nary': {
            const chr = mAttr(node, 'naryPr', 'chr', '∑');
            const mapped = symbolTable[chr];
            if (!mapped || !['\\sum','\\prod','\\int','\\oint'].includes(mapped)) {
                throw new Error('Toán tử n-ary Word chưa được hỗ trợ: ' + chr);
            }
            const lower = child(node, 'sub'), upper = child(node, 'sup');
            return mapped + (lower ? '_{' + next(lower) + '}' : '') +
                (upper ? '^{' + next(upper) + '}' : '') + val(node, 'e');
        }
        case 'func': {
            const fn = val(node, 'fName').replace(/\s+/g, '').trim();
            const standard = ['sin','cos','tan','cot','log','ln','lim','min','max','exp'].includes(fn)
                ? '\\' + fn : '\\operatorname{' + fn + '}';
            return standard + ' ' + val(node, 'e');
        }
        case 'limLow': return '{' + val(node, 'e') + '}_{' + val(node, 'lim') + '}';
        case 'limUpp': return '{' + val(node, 'e') + '}^{' + val(node, 'lim') + '}';
        case 'lim': return all(node);
        case 'acc': {
            const char = mAttr(node, 'accPr', 'chr', '̂');
            const accents = { '̂': '\\hat', '̄': '\\bar', '̃': '\\tilde', '⃗': '\\vec', '̇': '\\dot', '̈': '\\ddot', '→': '\\vec', '¯': '\\bar' };
            if (!accents[char]) throw new Error('Dấu toán học chưa hỗ trợ: ' + char);
            return accents[char] + '{' + val(node, 'e') + '}';
        }
        case 'bar': {
            const pos = mAttr(node, 'barPr', 'pos', 'top');
            return (pos === 'bot' ? '\\underline{' : '\\overline{') + val(node, 'e') + '}';
        }
        case 'groupChr': {
            const pos = mAttr(node, 'groupChrPr', 'pos', 'bot');
            return (pos === 'top' ? '\\overbrace{' : '\\underbrace{') + val(node, 'e') + '}';
        }
        case 'borderBox': return '\\boxed{' + val(node, 'e') + '}';
        case 'sPre':
            return '{}_{' + val(node, 'sub') + '}^{' + val(node, 'sup') + '}' + val(node, 'e');
        default:
            throw new Error('Cấu trúc Office Math chưa được hỗ trợ: m:' + n);
    }
}
export function convertOmmlToLatex(mathNode) {
    const latex = omml(mathNode).trim();
    if (!latex) throw new Error('Công thức Equation không có ký hiệu');
    return latex;
}
function parseXml(xml, path) {
    if (xml.length > MAX_PART_BYTES) throw new Error('Tệp XML trong DOCX quá lớn: ' + path);
    let errors = [];
    const dom = new DOMParser({
        onError(level, message) { if (level === 'error' || level === 'fatalError') errors.push(message); }
    }).parseFromString(xml, 'application/xml');
    if (!dom?.documentElement || errors.length || nameOf(dom.documentElement) === 'parsererror') {
        throw new Error('XML Word không hợp lệ tại ' + path + ': ' + errors.slice(0,2).join('; '));
    }
    return dom;
}
function imageMime(path) {
    const extension = String(path).split('.').pop()?.toLowerCase();
    return { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp' }[extension];
}
async function loadRelationships(zip) {
    const file = zip.file('word/_rels/document.xml.rels');
    const relationships = new Map();
    if (!file) return relationships;
    const xml = parseXml(await file.async('string'), 'word/_rels/document.xml.rels');
    for (const link of descendants(xml, 'Relationship')) {
        const id = attr(link, 'Id'), target = attr(link, 'Target');
        const type = attr(link, 'Type');
        if (!id || !target || !String(type).endsWith('/image')) continue;
        // External targets and path traversal are never followed.
        if (attr(link, 'TargetMode') === 'External' || /^[a-z]+:/i.test(target)) continue;
        const parts = [];
        for (const piece of ('word/' + target.replace(/\\/g,'/')).split('/')) {
            if (piece === '.' || !piece) continue;
            if (piece === '..') parts.pop(); else parts.push(piece);
        }
        const resolved = parts.join('/');
        if (resolved.startsWith('word/media/')) relationships.set(id, resolved);
    }
    return relationships;
}
const traverseChildren = (node, visit) => { for (const c of elements(node)) visit(c); };
function countEmbeddedObjects(body) {
    return descendants(body, 'OLEObject').length + descendants(body, 'object').filter(n => !descendants(n,'OLEObject').length).length;
}

/**
 * Returns exact paragraph-ordered text lines, optional images, and formula
 * records with original OMML. Formula tokens are not approved content.
 */
export async function inspectScientificDocx(arrayBuffer) {
    const inputLength = arrayBuffer?.byteLength ?? arrayBuffer?.length ?? 0;
    if (!inputLength || inputLength > MAX_DOCX_BYTES) throw new Error('File DOCX vượt giới hạn 24 MB hoặc rỗng.');
    const zip = await JSZip.loadAsync(arrayBuffer, { checkCRC32: true });
    const names = Object.keys(zip.files);
    if (names.length > MAX_PARTS) throw new Error('DOCX có quá nhiều thành phần.');
    let unpacked = 0;
    for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        unpacked += Number(entry._data?.uncompressedSize || 0);
        if (unpacked > MAX_DECOMPRESSED_BYTES) throw new Error('DOCX vượt giới hạn dữ liệu giải nén an toàn.');
    }
    const documentPart = zip.file('word/document.xml');
    if (!documentPart) throw new Error('DOCX không chứa word/document.xml');
    const documentXml = await documentPart.async('string');
    const dom = parseXml(documentXml, 'word/document.xml');
    const body = firstDesc(dom, 'body');
    if (!body) throw new Error('Word không có phần nội dung chính.');
    const rels = await loadRelationships(zip);
    const serializer = new XMLSerializer();
    const formulas = [], issues = [], lines = [];
    let imageCount = 0, paragraphCount = 0;

    const addEquation = mathNode => {
        const token = '__WMATH_' + String(formulas.length + 1).padStart(6, '0') + '__';
        const originalOmml = serializer.serializeToString(mathNode);
        let latex = '', status = 'parsed', reason = '';
        try { latex = convertOmmlToLatex(mathNode); }
        catch(error) { status='review'; reason=String(error?.message || error); }
        formulas.push({ token, sourceType:'omml', originalOmml, latex, status, reason, engineVersion:WORD_IMPORT_ENGINE_VERSION });
        if (status === 'review') issues.push({ kind:'formula', token, reason });
        return token;
    };
    const addUnsupported = (reason, xml) => {
        const token = '__WMATH_' + String(formulas.length + 1).padStart(6,'0') + '__';
        formulas.push({ token, sourceType:'embedded', originalOmml:xml, latex:'', status:'review', reason, engineVersion:WORD_IMPORT_ENGINE_VERSION });
        issues.push({kind:'formula',token,reason});
        return token;
    };
    async function loadImage(node) {
        const blip = firstDesc(node, 'blip');
        const fallback = firstDesc(node,'imagedata');
        const relId = attr(blip, 'embed') || attr(fallback, 'id');
        const path = rels.get(relId);
        if (!path || !zip.file(path)) {
            issues.push({kind:'image',reason:'Không tìm thấy tài nguyên hình ảnh: ' + (relId||'thiếu r:id')});
            return null;
        }
        const mime = imageMime(path);
        if (!mime) {
            issues.push({kind:'image',reason:'Định dạng ảnh DOCX chưa hỗ trợ: ' + path});
            return null;
        }
        const data = await zip.file(path).async('base64');
        imageCount++;
        return 'data:' + mime + ';base64,' + data;
    }
    async function parseParagraph(node) {
        paragraphCount++;
        const parts = [], images = [];
        const mark = n => {
            const pre = firstDesc(n,'rPr');
            if (!pre) return { start:'',end:'' };
            const u = child(pre,'u'), b=child(pre,'b');
            const underline=u && !['none','false','0'].includes(attr(u,'val'));
            const bold=b && !['false','0'].includes(attr(b,'val'));
            if (underline) return {start:'[[U]]',end:'[[/U]]'};
            if (bold) return {start:'[[B]]',end:'[[/B]]'};
            return {start:'',end:''};
        };
        async function visit(n) {
            const k=nameOf(n);
            if (k==='oMath' || k==='oMathPara') { parts.push(addEquation(n)); return; }
            if (k==='t' && nameOf(n.parentNode)==='r') {
                const style=mark(n.parentNode);
                parts.push(style.start + textOf(n) + style.end);
                return;
            }
            if (k==='tab') { parts.push('\t'); return; }
            if (k==='br' || k==='cr') { parts.push('\n'); return; }
            if (k==='drawing' || k==='pict') {
                const image=await loadImage(n);
                if(image) images.push(image);
                return;
            }
            if(k==='object' || k==='OLEObject') {
                // Old Equation Editor / MathType OLE source cannot be assumed
                // equivalent to the bitmap preview.
                parts.push(addUnsupported('Đối tượng MathType/Equation Editor cũ cần chuyển đổi hoặc xác minh thủ công', serializer.serializeToString(n)));
                return;
            }
            if (k==='del' || k==='delText') {
                issues.push({kind:'revision',reason:'Tài liệu còn theo dõi thay đổi (Word Track Changes). Hãy chấp nhận/từ chối trước khi import.'});
                return;
            }
            if (k==='sym') {
                parts.push(addUnsupported('Ký tự Symbol Font chưa được ánh xạ chắc chắn',serializer.serializeToString(n)));
                return;
            }
            if (k==='instrText' || k==='fldChar') {
                issues.push({kind:'field',reason:'Có trường Word (field code) cần kiểm tra; không suy đoán kết quả.'});
                return;
            }
            for (const c of elements(n)) await visit(c);
        }
        for(const part of elements(node)) await visit(part);
        const text=parts.join('').trim();
        if(images.length>1) issues.push({kind:'image',reason:'Đoạn Word có nhiều ảnh cần xác minh vị trí; không tự loại bỏ ảnh.'});
        if(text || images.length) lines.push({text,image:images[0]||'',images});
    }
    async function parseTable(node) {
        for(const row of children(node,'tr')) {
            const columns=[];
            const rowImages=[];
            for(const cell of children(row,'tc')) {
                const oldLines=lines.length;
                for(const item of elements(cell)) {
                    if(nameOf(item)==='p') await parseParagraph(item);
                    else if(nameOf(item)==='tbl') await parseTable(item);
                }
                const newLines=lines.splice(oldLines);
                columns.push(newLines.map(x=>x.text).join(' '));
                rowImages.push(...newLines.flatMap(x=>x.images||[]));
            }
            const text=columns.join('    ').trim();
            if(rowImages.length>1) issues.push({kind:'image',reason:'Hàng bảng Word có nhiều ảnh cần kiểm tra vị trí.'});
            if(text || rowImages.length) lines.push({text,image:rowImages[0]||'',images:rowImages});
        }
    }
    for(const block of elements(body)) {
        if(nameOf(block)==='p') await parseParagraph(block);
        else if(nameOf(block)==='tbl') await parseTable(block);
    }
    for(const item of names.filter(x=>/^word\/(?:header|footer)\d+\.xml$/.test(x))) {
        const src=await zip.file(item).async('string');
        if(/<m:oMath\b|Câu\s*\d+:/i.test(src))issues.push({kind:'document',reason:'Tài liệu có nội dung quan trọng trong header/footer: '+item});
    }
    return { lines, formulas, issues, imageCount, paragraphCount, sourceSize:inputLength, engineVersion:WORD_IMPORT_ENGINE_VERSION };
}
