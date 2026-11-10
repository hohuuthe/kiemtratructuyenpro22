/**
 * Bounded, fail-closed MathType OLE reader. No OLE code is executed.
 * Decoding and server-side source verification share the same MTEF parser.
 */
import {DOMParser} from '@xmldom/xmldom';
import {readMathTypeWmfSource} from './word-mathtype-preview.js';
import {convertMtefV5ToLatex} from './word-mtef-v5-reader.js';
export {convertMtefV5ToLatex} from './word-mtef-v5-reader.js';

const MAX_OLE_BYTES=4*1024*1024;
const MAX_MTEF_BYTES=96*1024;
const MATH_NS='urn:kiemtratructuyenpro22:mathtype-mtef:v1';
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
export function encodeMathTypeSource(mtef, originalOle=null, recoveredFromWmf=false){
    const bytes=asBytes(mtef);
    if(bytes.length>MAX_MTEF_BYTES)invalid('MTEF quá lớn');
    if(recoveredFromWmf && originalOle!==null)invalid('nguồn WMF khôi phục không được giả mạo OLE gốc');
    const selected=encodeBase64(bytes);
    // When the native OLE is stale, preserve BOTH sources. The displayed
    // WMF MTEF is the equation the teacher actually sees in Word.
    const alternative=originalOle===null?'':encodeBase64(asBytes(originalOle));
    const provenance=recoveredFromWmf?' source="wmf-recovery"':
        (originalOle===null?'':' source="wmf" originalOle="'+alternative+'"');
    const xml='<mt:equation xmlns:mt="'+MATH_NS+'" version="5"'+provenance+'>'+selected+'</mt:equation>';
    if(xml.length>150000)invalid('Hai nguồn MathType vượt giới hạn xác minh; cần kiểm tra thủ công');
    return xml;
}
export function verifyMathTypeSource(xml,latex,status) {
    const root=parseXml(xml);
    const visibleSource=root?.getAttribute('source')||null;
    const hasAlternative=visibleSource==='wmf';
    const recoveredFromWmf=visibleSource==='wmf-recovery';
    if(root.localName!=='equation'||root.namespaceURI!==MATH_NS||
       root.getAttribute('version')!=='5'||
       (visibleSource!==null&&!hasAlternative&&!recoveredFromWmf)||
       root.attributes.length!==(hasAlternative?4:recoveredFromWmf?3:2)||
       (hasAlternative && !root.getAttribute('originalOle'))||
       root.childNodes.length!==1||root.firstChild.nodeType!==3)
        invalid('nguồn MathType MTEF không đúng định dạng');
    const selected=decodeBase64(root.textContent);
    if(status!=='verified'&&status!=='manual_verified')invalid('chưa duyệt công thức MathType');
    // Source disagreement and a WMF-only recovery can never be approved
    // automatically, even if the client tampers with its status field.
    if((hasAlternative||recoveredFromWmf)&&status!=='manual_verified')
        invalid('MathType OLE/WMF cần giáo viên kiểm tra và xác nhận trước khi lưu');
    // Always decode the selected source, including after manual correction;
    // preserve the original MTEF as independently checkable provenance.
    const selectedLatex=convertMtefV5ToLatex(selected);
    // Both native OLE and cached WMF remain independently auditable.
    // Server never approves a forged mismatched-source provenance.
    if(hasAlternative){
        const originalOle=decodeBase64(root.getAttribute('originalOle'));
        const oleLatex=convertMtefV5ToLatex(originalOle);
        if(oleLatex===selectedLatex)invalid('không tồn tại khác biệt MathType OLE/WMF để ưu tiên WMF');
    }
    // Independently re-run decoding on the server for automatic approval.
    if(status==='verified'&&selectedLatex!==String(latex).trim())
        invalid('LaTeX không khớp với nguồn MathType MTEF');
    return true;
}

/** Allow only Word's local /oleObject relationship and its own embeddings/. */
export async function readMathTypeRelationship(zip,id,previewPath=null) {
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
    // Decode OLE and the optional displayed WMF independently: failure in an
    // obsolete or stale preview must not reject a valid editable OLE equation.
    let native=null,latex=null,nativeError=null;
    try {
        native=readMathTypeOleStream(await entry.async('uint8array'));
        latex=convertMtefV5ToLatex(native);
    } catch(error) { nativeError=error; }
    let preview=null,previewLatex=null,previewError=null;
    if(previewPath && /^word\/media\/[^/]+\.wmf$/i.test(previewPath)) {
        try {
            const previewEntry=zip.file(previewPath);
            if(!previewEntry)throw new Error('thiếu tệp hiển thị MathType');
            if(Number(previewEntry._data?.uncompressedSize||0)>MAX_OLE_BYTES)
                throw new Error('tệp hiển thị MathType vượt giới hạn');
            preview=readMathTypeWmfSource(await previewEntry.async('uint8array'));
            if(preview)previewLatex=convertMtefV5ToLatex(preview);
        } catch(error) { previewError=error; }
    }
    if(native && latex) {
        if(previewLatex!==null && previewLatex!==latex) {
            // Preserve the established behavior: visible WMF wins when both
            // independently decoded sources disagree. Keep the native bytes
            // for independent server-side provenance verification.
            return {
                mtef:preview,latex:previewLatex,
                sourceXml:encodeMathTypeSource(preview,native),
                sourcePreference:'wmf',requiresReview:true,
                notice:'MathType có hai nguồn khác nhau; cần giáo viên đối chiếu và xác nhận. Nguồn hiển thị Word (WMF: '+
                    previewLatex.slice(0,140)+'). Nguồn OLE gốc: '+latex.slice(0,140)+'.'
            };
        }
        return {mtef:native,latex,sourceXml:encodeMathTypeSource(native),
            sourcePreference:'ole',requiresReview:!!previewError,
            notice:previewError
                ? 'MathType: bản xem trước WMF bị lỗi, không đối chiếu được nội dung đang hiển thị với OLE gốc; cần giáo viên kiểm tra trước khi lưu.'
                : ''};
    }
    if(preview && previewLatex!==null) {
        // A valid MTEF comment is recoverable from the displayed WMF, but
        // without independently verifiable OLE its correctness must be
        // explicitly approved by the teacher before a question can be saved.
        return {
            mtef:preview,latex:previewLatex,sourceXml:encodeMathTypeSource(preview,null,true),
            sourcePreference:'wmf-recovery',requiresReview:true,
            notice:'Nguồn MathType OLE không đọc được ('+
                String(nativeError?.message||'không rõ lỗi').slice(0,140)+
                '). Đã khôi phục công thức từ dữ liệu WMF; cần giáo viên kiểm tra và xác nhận.'
        };
    }
    // No trustworthy source: retain the existing fail-closed behavior.
    invalid('không giải mã được MathType OLE ('+
        String(nativeError?.message||'không rõ lỗi').slice(0,140)+
        (previewError ? '); WMF ('+String(previewError?.message).slice(0,140)+')' : ')'));
}
