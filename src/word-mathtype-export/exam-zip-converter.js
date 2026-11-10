/**
 * Convert ONLY Word files in the server-selected exam ZIP to MathType.
 * Keep the original question choices and XLSX answer key byte-for-byte.
 * No partly converted ZIP is returned if any formula fails qualification.
 */
import JSZip from 'jszip';
import {finalizeWordExport} from '../word-export-format.js';
import {fail,aborted,MathTypeExportError} from './errors.js';

export async function convertExamExportZipToMathType(input, options={}) {
  const total=Number(options.expectedDocCount);
  if(!Number.isSafeInteger(total)||total<1||total>20)
    fail('INVALID_EXAM_COUNT','Số mã đề xuất Word không hợp lệ.');
  aborted(options.signal);
  const bytes=input instanceof Blob?new Uint8Array(await input.arrayBuffer()):
    input instanceof Uint8Array?input.slice():new Uint8Array(input||[]);
  if(bytes.length<4||bytes.length>128*1024*1024||bytes[0]!==80||
     bytes[1]!==75||bytes[2]!==3||bytes[3]!==4)
    fail('INVALID_EXAM_ZIP','Gói đề thi Word/Excel từ máy chủ không hợp lệ.');
  let zip;
  try {zip=await JSZip.loadAsync(bytes,{checkCRC32:true});}
  catch {fail('INVALID_EXAM_ZIP','Gói đề thi Word/Excel bị hỏng.');}
  const entries=Object.values(zip.files).filter(e=>!e.dir);
  const names=entries.map(e=>e.name);
  if(entries.length>21||names.some(n=>n.includes('/')||n.includes('\\')||
      n.startsWith('.')||n.includes('..')))
    fail('INVALID_EXAM_ZIP','Gói đề thi chứa tệp hoặc đường dẫn không được phép.');
  const docs=entries.filter(e=>/\.docx$/i.test(e.name));
  const sheets=entries.filter(e=>/\.xlsx$/i.test(e.name));
  if(docs.length!==total||sheets.length!==1||docs.length+sheets.length!==entries.length)
    fail('INVALID_EXAM_ZIP','Số đề thi hoặc file đáp án từ máy chủ không đúng cấu hình.');
  if(entries.reduce((size,e)=>size+Number(e._data?.uncompressedSize||0),0)>256*1024*1024)
    fail('RESOURCE_LIMIT','Gói Word/Excel vượt dung lượng an toàn.');
  for(let i=0;i<docs.length;i++){
    aborted(options.signal);
    const entry=docs[i];
    let word;
    try {
      word=await finalizeWordExport(
        new Blob([await entry.async('uint8array')],{
          type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }),{
          ...options,equationFormat:'mathtype',
          onPreviewProgress:info=>options.onPreviewProgress?.({
            ...info,fileIndex:i+1,filesTotal:docs.length
          })
        }
      );
    }catch(error){
      if(error instanceof MathTypeExportError)
        error.details={...error.details,file:entry.name,fileIndex:i+1,filesTotal:docs.length};
      throw error;
    }
    aborted(options.signal);
    if(!(word instanceof Blob)||word.size<1000)fail('INVALID_DOCX','Word MathType chưa được tạo hợp lệ.');
    zip.file(entry.name,new Uint8Array(await word.arrayBuffer()));
    options.onFileProgress?.({completed:i+1,total:docs.length,fileName:entry.name});
  }
  aborted(options.signal);
  const result=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}});
  if(result.length>128*1024*1024)fail('RESOURCE_LIMIT','Tệp kết quả quá lớn.');
  aborted(options.signal);
  return new Blob([result],{type:'application/zip'});
}
