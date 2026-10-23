/**
 * Loss-aware Office Open XML Word importer.
 * Reads DOCX's original WordprocessingML / OMML structure, not flattened HTML.
 * Every Office Math object becomes a unique provenance token until validated.
 * Unsupported structures are kept in the review queue; never guessed.
 */
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export const WORD_IMPORT_ENGINE_VERSION = 'word-omml-1.1';
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
    '∞': '\\infty', '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∮': '\\oint', '∬':'\\iint', '∭':'\\iiint',
    '√': '\\sqrt{}', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx',
    '×': '\\times', '÷': '\\div', '·': '\\cdot', '±': '\\pm', '∓': '\\mp',
    '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow',
    '∈': '\\in', '∉': '\\notin', '∩': '\\cap', '∪': '\\cup', '⊂': '\\subset',
    '⊆': '\\subseteq', '⊥': '\\perp', '∥': '\\parallel', '∠': '\\angle',
    '°': '°', '∂': '\\partial', '∇': '\\nabla', '∀': '\\forall',
    '∃': '\\exists', '∅': '\\emptyset',
    'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
    'ε': '\\varepsilon', 'ϵ':'\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
    'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
    'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho',
    'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon',
    'φ': '\\varphi', 'ϕ':'\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
    'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
    'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi',
    'Ψ': '\\Psi', 'Ω': '\\Omega'
};

const escapeTextRun = value => String(value).replace(/[\\{}%#$&_~^]/g, char =>
    ({'\\':'\\textbackslash{}','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[char] || '\\'+char));
const escapeMathRun = value => String(value).replace(/[\\{}%#$&_~^∞∑∏∫∮∬∭√≤≥≠≈×÷·±∓→←↔⇒∈∉∩∪⊂⊆⊥∥∠°∂∇∀∃∅α-ωϕϵΓΔΘΛΞΠΣΦΨΩ]/gu,
    char => (symbolTable[char] ? symbolTable[char] + (/^\\[A-Za-z]+$/.test(symbolTable[char]) ? '{}' : '') : null) || (char === bs ? '\\backslash ' :
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
// CT_Char distinguishes an omitted element (the OOXML default) from a
// present element without @val (an explicitly absent character).
const mChar = (node, prop, attribute, fallback) => {
    const element = child(child(node, prop), attribute);
    return element ? (attr(element, 'val') ?? '') : fallback;
};
const enabled = node => node && !['0','false','off'].includes(attr(node, 'val'));
const rejectProperties = (node, propertyName, unsupported) => {
    const properties = child(node, propertyName);
    for (const name of unsupported) {
        if (enabled(child(properties, name))) throw new Error('Thuộc tính Office Math cần xác minh: m:' + name);
    }
};
/**
 * Reverse only the ruled-matrix representation emitted by our Word exporter.
 * A partial border on an arbitrary expression is not an array rule. Require
 * complete row/column rules and explicit column alignments before unwrapping
 * the boxes; otherwise the ordinary converter keeps the object in review.
 */
function readRuledMatrix(node, rows, next) {
    const width=rows[0].length;
    if(width>64||rows.length>256)return null;
    const styles=[];
    for(const column of children(child(child(node,'mPr'),'mcs'),'mc')) {
        const properties=child(column,'mcPr');
        const count=Number(attr(child(properties,'count'),'val'));
        const align={left:'l',center:'c',right:'r'}[attr(child(properties,'mcJc'),'val')];
        if(!Number.isInteger(count)||count<1||count>width||!align)return null;
        styles.push(...Array(count).fill(align));
    }
    if(styles.length!==width)return null;
    let boxed=0;
    const cells=rows.map(row=>row.map(cell=>{
        const content=mathChildren(cell);
        if(content.length!==1||nameOf(content[0])!=='borderBox') {
            return {node:cell,top:false,bottom:false,left:false,right:false};
        }
        const box=content[0],properties=child(box,'borderBoxPr');
        const known=['hideTop','hideBot','hideLeft','hideRight','strikeH','strikeV','strikeBLTR','strikeTLBR','ctrlPr'];
        if(elements(properties).some(p=>!known.includes(nameOf(p))))return null;
        if(['strikeH','strikeV','strikeBLTR','strikeTLBR'].some(p=>enabled(child(properties,p))))return null;
        if(mathChildren(box).length!==1||!child(box,'e'))return null;
        boxed++;
        return {node:child(box,'e'),top:!enabled(child(properties,'hideTop')),
            bottom:!enabled(child(properties,'hideBot')),left:!enabled(child(properties,'hideLeft')),
            right:!enabled(child(properties,'hideRight'))};
    }));
    if(!boxed||cells.some(row=>row.some(cell=>!cell||cell.left)))return null;
    const top=cells[0][0].top;
    if(cells[0].some(cell=>cell.top!==top)||cells.slice(1).some(row=>row.some(cell=>cell.top)))return null;
    const bottom=cells.map(row=>row[0].bottom);
    if(cells.some((row,i)=>row.some(cell=>cell.bottom!==bottom[i])))return null;
    const right=cells[0].map(cell=>cell.right);
    if(cells.some(row=>row.some((cell,j)=>cell.right!==right[j])))return null;
    if(!top&&!bottom.some(Boolean)&&!right.some(Boolean))return null;
    const values=cells.map(row=>row.map(cell=>next(cell.node)));
    // The current editable-array writer splits literal cell/row separators.
    // A nested matrix or literal ampersand would therefore lose its rules;
    // hold it for review instead of handing it to that writer as equivalent.
    if(values.some(row=>row.some(value=>value.includes('&')||value.includes('\\\\'))))return null;
    const spec=styles.map((style,j)=>style+(right[j]?'|':'')).join('');
    let body=top?'\\hline ':'';
    for(let i=0;i<cells.length;i++) {
        body+=values[i].map(value=>value.trim()?value:'').join(' & ');
        if(i<cells.length-1||bottom[i])body+=' \\\\ ';
        if(bottom[i])body+='\\hline ';
    }
    return '\\begin{array}{'+spec+'}'+body+'\\end{array}';
}
function omml(node, depth = 0) {
    if (!node) throw new Error('Thiếu phần tử Equation');
    if (depth > 70) throw new Error('Độ sâu công thức vượt giới hạn an toàn');
    const n = nameOf(node);
    const next = x => omml(x, depth + 1);
    const all = x => mathChildren(x).map(next).join('');
    const val = (parent, tag) => next(group(parent, tag));
    switch(n) {
        case 'oMath': case 'oMathPara': case 'e': case 'num': case 'den':
        case 'sub': case 'sup': case 'deg': case 'fName':
            return all(node);
        case 'box':
            rejectProperties(node, 'boxPr', ['opEmu','diff']);
            return all(node);
        case 'r': {
            const parts = children(node, 't');
            if (!parts.length) throw new Error('Ký hiệu trong Equation Word không có nội dung m:t');
            const raw=parts.map(textOf).join('');
            const properties=child(node,'rPr');
            rejectProperties(node, 'rPr', ['lit']);
            const style=attr(child(properties,'sty'),'val');
            const script=attr(child(properties,'scr'),'val') || 'roman';
            if(enabled(child(properties,'nor')) || (style==='p' && /\s/u.test(raw))) {
                if(script!=='roman' || (style && style!=='p')) {
                    throw new Error('Văn bản thường có kiểu chữ toán kết hợp cần xác minh');
                }
                return '\\text{'+escapeTextRun(raw)+'}';
            }
            if(raw.includes('\\'))throw new Error('Equation chứa backslash dạng ký tự, không được tự hiểu là lệnh LaTeX');
            if(/[\^√]/u.test(raw))throw new Error('Equation chứa ký hiệu tuyến tính cần xác minh, không tự đổi thành cấu trúc toán');
            const escaped=escapeMathRun(raw);
            const scripts={ 'double-struck':'\\mathbb', script:'\\mathcal', fraktur:'\\mathfrak',
                'sans-serif':'\\mathsf', monospace:'\\mathtt' };
            if(script!=='roman') {
                if(!scripts[script] || style!=='p' || !/^[A-Za-z0-9]+$/.test(raw)) {
                    throw new Error('Kiểu chữ toán học cần xác minh: '+script+' / '+(style||'default'));
                }
                return scripts[script]+'{'+escaped+'}';
            }
            if(style==='b' || style==='bi') {
                if(style==='b' && !/^[A-Za-z0-9]+$/.test(raw))throw new Error('Ký hiệu in đậm đứng cần xác minh trước khi đổi LaTeX');
                return (style==='b'?'\\mathbf':'\\boldsymbol')+'{'+escaped+'}';
            }
            if(style && !['p','i'].includes(style))throw new Error('Kiểu Office Math chưa hỗ trợ: '+style);
            // Word's m:sty="p" marks upright symbols. Preserve
            // chemical element symbols and scientific units as roman math.
            if(style==='p' && /[A-Za-z]/.test(raw))return '\\mathrm{'+escaped+'}';
            return escaped;
        }
        case 't': return escapeMathRun(textOf(node));
        case 'f': {
            const type=mAttr(node,'fPr','type','bar');
            if(type!=='bar')throw new Error('Dạng phân số Word chưa chuyển đổi độc lập: '+type);
            return '\\frac{' + val(node, 'num') + '}{' + val(node, 'den') + '}';
        }
        case 'sSup': return '{' + val(node, 'e') + '}^{' + val(node, 'sup') + '}';
        case 'sSub': return '{' + val(node, 'e') + '}_{' + val(node, 'sub') + '}';
        case 'sSubSup': return '{' + val(node, 'e') + '}_{' + val(node, 'sub') + '}^{' + val(node, 'sup') + '}';
        case 'rad': {
            const index = child(node, 'deg');
            const root = val(node, 'e');
            const deg = index ? next(index) : '';
            if(deg && enabled(child(child(node,'radPr'),'degHide'))) {
                throw new Error('Căn Word chứa bậc căn bị ẩn cần xác minh');
            }
            return deg ? '\\sqrt[' + deg + ']{' + root + '}' : '\\sqrt{' + root + '}';
        }
        case 'd': {
            const open = mChar(node, 'dPr', 'begChr', '(');
            const close = mChar(node, 'dPr', 'endChr', ')');
            const separator = mChar(node, 'dPr', 'sepChr', '|');
            const bases=children(node,'e');
            // A no-bar fraction inside exactly one pair of parentheses is
            // the binomial object. A bare noBar stack must never become a/b.
            const firstBase=mathChildren(bases[0]);
            if(open==='(' && close===')' && bases.length===1 && firstBase.length===1 &&
                nameOf(firstBase[0])==='f' && mAttr(firstBase[0],'fPr','type','bar')==='noBar') {
                return '\\binom{'+val(firstBase[0],'num')+'}{'+val(firstBase[0],'den')+'}';
            }
            const values = bases.map(next);
            if (!values.length) throw new Error('Dấu ngoặc Equation không có nội dung');
            return '\\left' + delimiters(open) + values.join(separator==='│'?'|':escapeMathRun(separator)) + '\\right' + delimiters(close);
        }
        case 'm': {
            const rows = children(node, 'mr').map(row => children(row, 'e'));
            if (!rows.length || !rows[0].length || rows.some(row => row.length !== rows[0].length)) {
                throw new Error('Ma trận Word thiếu hàng hoặc số cột không đồng đều');
            }
            const ruled=readRuledMatrix(node,rows,next);
            if(ruled)return ruled;
            return '\\begin{matrix}' + rows.map(row => row.map(next).join(' & ')).join(' \\\\ ') + '\\end{matrix}';
        }
        case 'eqArr': {
            const rows = children(node, 'e').map(next);
            if (!rows.length) throw new Error('Equation nhiều dòng trống');
            return '\\begin{aligned}' + rows.join(' \\\\ ') + '\\end{aligned}';
        }
        case 'nary': {
            const chr = mChar(node, 'naryPr', 'chr', '∫');
            const mapped = symbolTable[chr];
            if (!mapped || !['\\sum','\\prod','\\int','\\oint','\\iint','\\iiint'].includes(mapped)) {
                throw new Error('Toán tử n-ary Word chưa được hỗ trợ: ' + chr);
            }
            const lower = child(node, 'sub'), upper = child(node, 'sup');
            for(const [name,argument] of [['subHide',lower],['supHide',upper]]) {
                if(enabled(child(child(node,'naryPr'),name)) && argument && textOf(argument).trim()) {
                    throw new Error('Giới hạn toán tử Word bị ẩn cần xác minh: '+name);
                }
            }
            return mapped + (lower ? '_{' + next(lower) + '}' : '') +
                (upper ? '^{' + next(upper) + '}' : '') + ' ' + val(node, 'e');
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
            const char = mChar(node, 'accPr', 'chr', '̂');
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
            const chr = mChar(node,'groupChrPr','chr','⏟');
            const commands = { 'top:⏞':'\\overbrace', 'bot:⏟':'\\underbrace',
                'top:→':'\\overrightarrow', 'top:←':'\\overleftarrow', 'top:↔':'\\overleftrightarrow' };
            const command=commands[pos+':'+chr];
            if(!command)throw new Error('Ký hiệu nhóm Word cần xác minh: '+chr+' / '+pos);
            return command+'{'+val(node,'e')+'}';
        }
        case 'borderBox':
            rejectProperties(node,'borderBoxPr',['hideTop','hideBot','hideLeft','hideRight','strikeH','strikeV','strikeBLTR','strikeTLBR']);
            return '\\boxed{' + val(node, 'e') + '}';
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
    if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('DOCX chứa DTD/ENTITY XML không an toàn: '+path);
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
        const compressedImagePart=zip.file(path);
        if(Number(compressedImagePart._data?.uncompressedSize||0)>8*1024*1024){
            issues.push({kind:'image',reason:'Ảnh Word quá lớn để xử lý an toàn: '+path});
            return null;
        }
        const data = await compressedImagePart.async('base64');
        imageCount++;
        return 'data:' + mime + ';base64,' + data;
    }
    async function parseParagraph(node) {
        paragraphCount++;
        if(descendants(node,'numPr').length) issues.push({kind:'numbering',reason:'Có danh sách đánh số tự động Word; cần đối chiếu thứ tự A-D và số câu.'});
        if(descendants(node,'ins').length) issues.push({kind:'revision',reason:'Có nội dung Word Track Changes chưa được chấp nhận trước import.'});
        const parts = [], images = [];
        const mark = n => {
            const pre = firstDesc(n,'rPr');
            if (!pre) return { start:'',end:'' };
            const u = child(pre,'u'), b=child(pre,'b');
            const underline=u && !['none','false','0'].includes(attr(u,'val'));
            const bold=b && !['false','0'].includes(attr(b,'val'));
            let start='',end='';
            if (underline) { start+='[[U]]'; end='[[/U]]'+end; }
            else if (bold) { start+='[[B]]'; end='[[/B]]'+end; }
            const position=attr(child(pre,'vertAlign'),'val');
            if(position==='subscript'||position==='superscript') {
                const tag=position==='subscript'?'sub':'sup';
                start+='<'+tag+'>'; end='</'+tag+'>'+end;
            }
            return {start,end};
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
            if (k==='AlternateContent' || k==='altChunk' || k==='moveFrom' || k==='moveTo') {
                issues.push({kind:'structure',reason:'Nội dung Word chưa được xác minh: '+k+'. Không tự bỏ hoặc ghép các phiên bản thay thế.'});
                return;
            }
            if (k==='sdt') {
                const content=child(n,'sdtContent');
                if(!content)issues.push({kind:'structure',reason:'Content control Word thiếu phần nội dung.'});
                else for(const c of elements(content))await visit(c);
                return;
            }
            for (const c of elements(n)) await visit(c);
        }
        for(const part of elements(node)) await visit(part);
        const text=parts.join('').trim();
        if(images.length>1) issues.push({kind:'image',reason:'Đoạn Word có nhiều ảnh cần xác minh vị trí; không tự loại bỏ ảnh.'});
        if(images.length && text) issues.push({kind:'image',reason:'Ảnh nằm cùng đoạn với văn bản; cần tách ảnh khỏi câu hoặc đối chiếu vị trí trước khi lưu.'});
        if(text || images.length) lines.push({text,image:images[0]||'',images});
    }
    async function parseTable(node) {
        for(const item of elements(node)) {
            if(!['tr','tblPr','tblGrid'].includes(nameOf(item))) {
                issues.push({kind:'structure',reason:'Cấu trúc hàng bảng Word chưa hỗ trợ: '+nameOf(item)});
            }
        }
        for(const row of children(node,'tr')) {
            for(const item of elements(row)) {
                if(!['tc','trPr','tblPrEx'].includes(nameOf(item))) {
                    issues.push({kind:'structure',reason:'Cấu trúc ô bảng Word chưa hỗ trợ: '+nameOf(item)});
                }
            }
            if(children(row,'tc').length>1) issues.push({kind:'table',reason:'Bảng Word nhiều cột chưa bảo toàn cấu trúc khi chuyển thành câu hỏi; cần xem lại nguồn.'});
            const columns=[];
            const rowImages=[];
            for(const cell of children(row,'tc')) {
                const oldLines=lines.length;
                for(const item of elements(cell)) {
                    if(nameOf(item)!=='tcPr')await parseBlock(item);
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
    async function parseBlock(block) {
        const kind=nameOf(block);
        if(kind==='p')await parseParagraph(block);
        else if(kind==='tbl')await parseTable(block);
        else if(kind==='sdt') {
            const content=child(block,'sdtContent');
            if(!content)issues.push({kind:'structure',reason:'Content control Word thiếu phần nội dung.'});
            else for(const item of elements(content))await parseBlock(item);
        } else if(kind==='customXml') {
            for(const item of elements(block))if(nameOf(item)!=='customXmlPr')await parseBlock(item);
        } else if(!['sectPr','bookmarkStart','bookmarkEnd','proofErr','permStart','permEnd'].includes(kind)) {
            issues.push({kind:'structure',reason:'Khối nội dung Word chưa hỗ trợ: '+kind+'. Không cho phép lưu tài liệu bị bỏ sót nội dung.'});
        }
    }
    for(const block of elements(body))await parseBlock(block);
    for(const item of names.filter(x=>/^word\/(?:header|footer)\d+\.xml$/.test(x))) {
        const src=await zip.file(item).async('string');
        if(/<m:oMath\b|Câu\s*\d+:/i.test(src))issues.push({kind:'document',reason:'Tài liệu có nội dung quan trọng trong header/footer: '+item});
    }
    return { lines, formulas, issues, imageCount, paragraphCount, sourceSize:inputLength, engineVersion:WORD_IMPORT_ENGINE_VERSION };
}

