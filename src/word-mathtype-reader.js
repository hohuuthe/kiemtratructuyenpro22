/**
 * Narrow, fail-closed importer for MathType MTEF v5 inside Word OLE objects.
 * Does not replace the existing OMML/LaTeX importer and does not read previews.
 * No executable OLE content is opened: only bounded CFB directory/FAT bytes.
 */
import {DOMParser} from '@xmldom/xmldom';

const MAX_OLE_BYTES=4*1024*1024;
const MAX_MTEF_BYTES=96*1024;
const MATH_NS='urn:kiemtratructuyenpro22:mathtype-mtef:v1';
const WORD_RELS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CFB_SIGNATURE=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
const END=0xfffffffe;
const FREE=0xffffffff;
const invalid=reason=>{throw new Error('MathType OLE: '+reason);};
const asBytes=value=>value instanceof Uint8Array?value:new Uint8Array(value);
const u16=(dv,at)=>dv.getUint16(at,true);
const u32=(dv,at)=>dv.getUint32(at,true);

/** Read just the Equation Native stream from a bounded OLE compound file. */
export function readMathTypeOleStream(input) {
    const bytes=asBytes(input);
    if(bytes.length<512||bytes.length>MAX_OLE_BYTES)invalid('kích thước đối tượng không hợp lệ');
    if(!CFB_SIGNATURE.every((byte,i)=>bytes[i]===byte))invalid('không phải tệp OLE Compound File');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const major=u16(view,26),sectorShift=u16(view,30),miniShift=u16(view,32);
    if(!((major===3&&sectorShift===9)||(major===4&&sectorShift===12))||miniShift!==6)invalid('phiên bản OLE không hỗ trợ');
    const sectorSize=1<<sectorShift,miniSize=64,headerSize=sectorSize;
    const sectors=Math.floor((bytes.length-headerSize)/sectorSize);
    if(sectors<1||u32(view,56)!==4096)invalid('cấu trúc sector OLE không hợp lệ');
    const sector=sid=>{
        if(!Number.isInteger(sid)||sid<0||sid>=sectors)invalid('sector OLE vượt giới hạn');
        const from=headerSize+sid*sectorSize;
        return bytes.subarray(from,from+sectorSize);
    };
    const fatSectors=u32(view,44),dirSid=u32(view,48),
        miniFatSid=u32(view,60),miniFatCount=u32(view,64),
        difatSid=u32(view,68),difatCount=u32(view,72);
    if(fatSectors<1||fatSectors>sectors||miniFatCount>sectors||difatCount>sectors)invalid('bảng FAT OLE không hợp lệ');
    const difat=[];
    for(let i=0;i<109;i++){const sid=u32(view,76+4*i);if(sid!==FREE)difat.push(sid);}
    let nextDifat=difatSid;
    for(let i=0;i<difatCount;i++){
        const chunk=sector(nextDifat),d=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength);
        for(let j=0;j<sectorSize/4-1;j++){const sid=u32(d,j*4);if(sid!==FREE)difat.push(sid);}
        nextDifat=u32(d,sectorSize-4);
    }
    if(difat.length!==fatSectors)invalid('số lượng FAT sector không khớp');
    const fat=[];
    for(const sid of difat){
        const chunk=sector(sid),d=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength);
        for(let i=0;i<sectorSize;i+=4)fat.push(u32(d,i));
    }
    const chain=(first,nextFn,getBytes,size,maximum,unit)=>{
        if(size!==null&&(size<0||size>maximum))invalid('luồng OLE vượt giới hạn');
        const chunks=[],seen=new Set();
        let sid=first,total=0;
        while(sid!==END){
            if(sid===FREE||seen.has(sid)||chunks.length>Math.ceil(maximum/unit)+2)invalid('chuỗi sector OLE bị lặp hoặc lỗi');
            seen.add(sid);
            const part=getBytes(sid);
            chunks.push(part);
            total+=part.length;
            sid=nextFn(sid);
            if(sid===undefined)invalid('FAT OLE thiếu phần tử');
            if(size!==null&&total>=size)break;
        }
        if(size!==null&&total<size)invalid('luồng OLE bị cắt');
        if(size===null&&total>maximum)invalid('thư mục OLE vượt giới hạn');
        const output=new Uint8Array(total);
        let cursor=0;
        for(const part of chunks){output.set(part,cursor);cursor+=part.length;}
        return size===null?output:output.subarray(0,size);
    };
    const full=(start,size,limit=MAX_OLE_BYTES)=>chain(start,sid=>fat[sid],sector,size,limit,sectorSize);
    const directory=full(dirSid,null,512*1024);
    let root=null,equation=null;
    for(let at=0;at+128<=directory.length;at+=128){
        const d=new DataView(directory.buffer,directory.byteOffset+at,128);
        const nameBytes=u16(d,64),type=d.getUint8(66);
        if(!type)continue;
        if(nameBytes<2||nameBytes>64||nameBytes%2)invalid('tên luồng OLE lỗi');
        let name='';
        for(let i=0;i<nameBytes-2;i+=2)name+=String.fromCharCode(u16(d,i));
        const sizeLo=u32(d,120),sizeHi=u32(d,124);
        if((major===4&&sizeHi!==0)||sizeLo>MAX_OLE_BYTES) {
            if(type===2&&name==='Equation Native')invalid('luồng công thức OLE quá lớn');
            continue;
        }
        const record={name,type,start:u32(d,116),size:sizeLo};
        if(type===5){if(root)invalid('nhiều thư mục gốc OLE');root=record;}
        if(type===2&&name==='Equation Native'){
            if(equation)invalid('nhiều luồng Equation Native');
            equation=record;
        }
    }
    if(!root||!equation||equation.size<6)invalid('thiếu luồng Equation Native');
    let stream;
    if(equation.size<4096){
        if(miniFatCount<1||miniFatSid===END)invalid('thiếu MiniFAT');
        const miniFatBytes=full(miniFatSid,miniFatCount*sectorSize,Math.min(MAX_OLE_BYTES,miniFatCount*sectorSize));
        const miniDv=new DataView(miniFatBytes.buffer,miniFatBytes.byteOffset,miniFatBytes.byteLength);
        const miniFat=Array.from({length:miniFatBytes.length/4},(_,i)=>u32(miniDv,i*4));
        const rootData=full(root.start,root.size);
        const miniSector=sid=>{
            const start=sid*miniSize;
            if(!Number.isInteger(sid)||sid<0||start+miniSize>rootData.length)invalid('MiniFAT truy cập ngoài luồng');
            return rootData.subarray(start,start+miniSize);
        };
        stream=chain(equation.start,sid=>miniFat[sid],miniSector,equation.size,MAX_MTEF_BYTES+28,miniSize);
    }else{
        stream=full(equation.start,equation.size,MAX_MTEF_BYTES+28);
    }
    if(stream.length<28||stream[0]!==28||stream[1]!==0)invalid('Equation Native thiếu header 28 byte');
    const hdr=new DataView(stream.buffer,stream.byteOffset,stream.byteLength);
    const bodySize=u32(hdr,8);
    if(bodySize<7||bodySize>MAX_MTEF_BYTES||bodySize>stream.length-28)invalid('chiều dài MTEF trong header không hợp lệ');
    return stream.slice(28,28+bodySize);
}

class ByteReader {
    constructor(value){this.bytes=asBytes(value);this.position=0;}
    byte(){if(this.position>=this.bytes.length)invalid('MTEF kết thúc đột ngột');return this.bytes[this.position++];}
    word(){const a=this.byte();return a|(this.byte()<<8);}
    cstring(){
        let value='';
        for(let i=0;i<256;i++){const code=this.byte();if(!code)return value;value+=String.fromCharCode(code);}
        invalid('chuỗi ký tự MTEF không có điểm kết thúc');
    }
}

const mtSymbols=Object.freeze({
    'α':'\\alpha{}','β':'\\beta{}','γ':'\\gamma{}','δ':'\\delta{}',
    'ε':'\\varepsilon{}','ϵ':'\\epsilon{}','θ':'\\theta{}','λ':'\\lambda{}',
    'μ':'\\mu{}','π':'\\pi{}','σ':'\\sigma{}','φ':'\\varphi{}','ϕ':'\\phi{}',
    'ω':'\\omega{}','Δ':'\\Delta{}','Ω':'\\Omega{}','Σ':'\\Sigma{}',
    '≤':'\\leq{}','≥':'\\geq{}','≠':'\\neq{}','≈':'\\approx{}',
    '±':'\\pm{}','∓':'\\mp{}','×':'\\times{}','÷':'\\div{}',
    '∞':'\\infty{}','∑':'\\sum{}','∏':'\\prod{}','∫':'\\int{}',
    '→':'\\to{}','←':'\\leftarrow{}','∈':'\\in{}','∂':'\\partial{}'
});
function codeToLatex(code,typeface){
    if(code===0||code<32||code>=0xd800&&code<=0xdfff||code>=0xe000&&code<=0xf8ff)
        invalid('ký tự MTCode chưa ánh xạ an toàn');
    const char=String.fromCharCode(code);
    if(typeface===1){
        if(/^[A-Za-z0-9 ]$/.test(char))return '\\mathrm{'+char+'}';
        invalid('kiểu chữ MathType văn bản chưa hỗ trợ: '+char);
    }
    if(![3,4,5,6,8].includes(typeface))invalid('kiểu chữ MathType chưa xác minh: '+typeface);
    if(Object.hasOwn(mtSymbols,char))return mtSymbols[char];
    if(/^[A-Za-z0-9+\-=.,:;()[\]<>|/*!?]$/.test(char))return char;
    if(['°','·','∧','∨'].includes(char))return char;
    invalid('ký hiệu MathType cần ánh xạ độc lập: U+'+code.toString(16));
}

/** Strict MTEF v5 -> LaTeX subset. Unknown templates MUST be manually reviewed. */
export function convertMtefV5ToLatex(input) {
    const bytes=asBytes(input);
    if(bytes.length<7||bytes.length>MAX_MTEF_BYTES)invalid('MTEF rỗng hoặc quá lớn');
    const r=new ByteReader(bytes);
    if(r.byte()!==5)invalid('hiện hỗ trợ tự động MTEF phiên bản 5');
    const platform=r.byte(),product=r.byte(),version=r.byte(),subversion=r.byte();
    if(platform>2||product>2||version>100||subversion>100)invalid('header MTEF không hợp lệ');
    r.cstring();
    const eqOptions=r.byte();
    if(eqOptions&~1)invalid('tùy chọn đầu MTEF chưa hỗ trợ');
    let depth=0,recordCount=0;
    const parseList=()=>{
        if(++depth>32)invalid('công thức MTEF lồng quá sâu');
        const records=[];
        while(true){
            if(++recordCount>8192)invalid('MTEF có quá nhiều bản ghi');
            const type=r.byte();
            if(type===0)break;
            if(type===10||type===11||type===12||type===13||type===14)continue;
            if(type===8){r.byte();r.byte();continue;}
            if(type===17){r.byte();r.cstring();continue;}
            if(type===19){r.cstring();continue;}
            if(type===9||type===18||type===15||type===16)
                invalid('kích thước/màu/cấu hình MTEF cần đối chiếu trước khi tự chuyển đổi');
            if(![1,2,3].includes(type))invalid('bản ghi MTEF chưa hỗ trợ: '+type);
            const options=r.byte();
            if(options&8)invalid('công thức có dịch vị trí MathType (nudge)');
            if(type===1){
                if(options&~7)invalid('tùy chọn LINE MTEF chưa hỗ trợ');
                if(options&1)invalid('LINE MTEF chứa ô công thức trống');
                if(options&4)invalid('LINE MTEF có khoảng cách tùy chỉnh');
                if(options&2)invalid('LINE MTEF có ruler chưa hỗ trợ');
                records.push({type:'line',latex:parseList().map(x=>x.latex).join('')});
            }else if(type===2){
                if(options&~0x3f)invalid('tùy chọn ký tự MTEF không hợp lệ');
                if(options&1)invalid('ký tự MTEF có trang trí (EMBELL) chưa được ánh xạ');
                if(options&2)invalid('ký tự MTEF đánh dấu hàm chưa được xác minh');
                if((options&4)&&(options&16))invalid('ký tự MTEF có nhiều định dạng vị trí font');
                const biased=r.byte(),typeface=biased===255?r.word()-32768:biased-128;
                if(options&32)invalid('ký tự MTEF thiếu MTCode Unicode');
                const code=r.word();
                if(options&4)r.byte();
                if(options&16)r.word();
                records.push({type:'char',latex:codeToLatex(code,typeface)});
            }else{
                if(options!==0)invalid('thuộc tính TMPL MTEF chưa hỗ trợ');
                const selector=r.byte(),firstVariation=r.byte();
                const variation=(firstVariation&0x80)?(firstVariation&0x7f)|(r.byte()<<8):firstVariation;
                const flags=r.byte();
                if(flags!==0)invalid('tùy chọn template MathType cần xác minh');
                if(![10,11,27,28,29].includes(selector)||variation!==0)
                    invalid('template MathType chưa hỗ trợ: '+selector+'/'+variation);
                const slots=parseList().filter(x=>x.type==='line');
                const all=slots.map(x=>x.latex);
                if(slots.some(x=>!x.latex.trim()))invalid('template MathType chứa ô công thức thiếu');
                let latex='';
                if(selector===10&&slots.length===1)latex='\\sqrt{'+all[0]+'}';
                else if(selector===11&&slots.length===2)latex='\\frac{'+all[0]+'}{'+all[1]+'}';
                else if(selector===27&&slots.length===1)latex='_{'+all[0]+'}';
                else if(selector===28&&slots.length===1)latex='^{'+all[0]+'}';
                else if(selector===29&&slots.length===2)latex='_{'+all[0]+'}^{'+all[1]+'}';
                else invalid('template MathType sai số ô: '+selector);
                records.push({type:'template',latex});
            }
        }
        depth--;
        return records;
    };
    const tree=parseList();
    if(r.position!==bytes.length)invalid('MTEF có dữ liệu thừa chưa xác minh');
    if(tree.length!==1||tree[0].type!=='line'||!tree[0].latex.trim())
        invalid('MTEF thiếu đúng một dòng công thức gốc');
    return tree[0].latex;
}

const parseXml=value=>{
    if(value.length>160000||/<!DOCTYPE|<!ENTITY/i.test(value))invalid('XML nguồn không an toàn');
    const failures=[];
    const xml=new DOMParser({onError(level,error){
        if(level==='error'||level==='fatalError')failures.push(error);
    }}).parseFromString(value,'application/xml');
    if(failures.length||!xml?.documentElement||xml.documentElement.localName==='parsererror')
        invalid('XML nguồn MTEF không hợp lệ');
    return xml.documentElement;
};
function encodeBase64(bytes){
    let binary='';
    for(let i=0;i<bytes.length;i+=4096)binary+=String.fromCharCode(...bytes.subarray(i,i+4096));
    return btoa(binary);
}
function decodeBase64(text){
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)||text.length>130000)
        invalid('dữ liệu MTEF base64 không hợp lệ');
    const binary=atob(text);
    if(binary.length>MAX_MTEF_BYTES)invalid('MTEF quá lớn');
    return Uint8Array.from(binary,char=>char.charCodeAt(0));
}

/** Ephemeral provenance for the existing verified-import API; no schema change. */
export function encodeMathTypeSource(mtef){
    const bytes=asBytes(mtef);
    if(bytes.length>MAX_MTEF_BYTES)invalid('MTEF quá lớn');
    return '<mt:equation xmlns:mt="'+MATH_NS+'" version="5">'+encodeBase64(bytes)+'</mt:equation>';
}
export function verifyMathTypeSource(xml,latex,status) {
    const root=parseXml(xml);
    if(root.localName!=='equation'||root.namespaceURI!==MATH_NS||root.attributes.length!==2||
        root.getAttribute('version')!=='5'||root.childNodes.length!==1||root.firstChild.nodeType!==3)
        invalid('nguồn MathType MTEF không đúng định dạng');
    const original=decodeBase64(root.textContent);
    // Independently re-run decoding on the server for automatic approval.
    if(status==='verified'&&convertMtefV5ToLatex(original)!==String(latex).trim())
        invalid('LaTeX không khớp với nguồn MathType MTEF');
    if(status!=='verified'&&status!=='manual_verified')invalid('chưa duyệt công thức MathType');
    return true;
}

/** Allow only Word's local /oleObject relationship and its own embeddings/. */
export async function readMathTypeRelationship(zip,id) {
    if(!id||!/^rId[0-9A-Za-z_-]{1,100}$/.test(id))invalid('thiếu r:id MathType');
    const relFile=zip.file('word/_rels/document.xml.rels');
    if(!relFile)invalid('không tìm thấy quan hệ Word OLE');
    const xml=parseXml(await relFile.async('string'));
    let target=null;
    for(let i=0;i<xml.getElementsByTagName('*').length;i++){
        const item=xml.getElementsByTagName('*').item(i);
        if(item.localName!=='Relationship'||item.getAttribute('Id')!==id)continue;
        if(target!==null)invalid('quan hệ OLE r:id bị trùng');
        if(!String(item.getAttribute('Type')||'').endsWith('/oleObject')||
           item.getAttribute('TargetMode')==='External')
            invalid('quan hệ không phải OLE nội bộ');
        const t=item.getAttribute('Target');
        if(!/^(?:\.\/)?embeddings\/[A-Za-z0-9_.-]+\.bin$/i.test(t||''))
            invalid('đường dẫn OLE không thuộc word/embeddings');
        target='word/'+t.replace(/^\.\//,'');
    }
    if(!target)invalid('không tìm thấy tham chiếu MathType');
    const entry=zip.file(target);
    if(!entry)invalid('thiếu tệp nhúng MathType: '+target);
    if(Number(entry._data?.uncompressedSize||0)>MAX_OLE_BYTES)invalid('OLE nhúng quá lớn');
    const bytes=await entry.async('uint8array');
    const mtef=readMathTypeOleStream(bytes);
    return {mtef,latex:convertMtefV5ToLatex(mtef),sourceXml:encodeMathTypeSource(mtef)};
}
