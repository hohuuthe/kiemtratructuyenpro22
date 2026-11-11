/**
 * Isolated DOCX postprocessor. Qualification prototype, NOT native-editor certified.
 * Input is immutable; an error returns NO partially converted document.
 */
import JSZip from 'jszip';
import {XMLSerializer} from '@xmldom/xmldom';
import {NS,parseXml,ommlToAst,elements,local} from './omml-ast.js';
import {astToMtef} from './mtef-writer.js';
import {createMathTypeOle} from './cfb-writer.js';
import {fail,aborted,MathTypeExportError} from './errors.js';
const serialize=n=>new XMLSerializer().serializeToString(n);
const utf8=s=>new TextEncoder().encode(s);
const toArray=x=>Array.from(x||[]);
const PNG=Uint8Array.from([137,80,78,71,13,10,26,10]);
const maxDocx=24*1024*1024,maxExpanded=128*1024*1024;
async function yieldMainThread(signal){
  aborted(signal);
  if(globalThis.scheduler?.yield)await globalThis.scheduler.yield();
  else await new Promise(resolve=>setTimeout(resolve,0));
  aborted(signal);
}
export async function sha256(bytes){
  if(!globalThis.crypto?.subtle)fail('CRYPTO_REQUIRED','Web Crypto is required to verify exported formulas.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
const relPath=part=>part.slice(0,part.lastIndexOf('/')+1)+'_rels/'+part.slice(part.lastIndexOf('/')+1)+'.rels';
function freeId(root,tag,attribute,prefix,start){
  const used=new Set(toArray(root.getElementsByTagName('*')).map(n=>n.getAttribute(attribute)).filter(Boolean));
  let n=start;while(used.has(prefix+n))n++;return prefix+n;
}
function pngCheck(preview){
  if(!(preview?.png instanceof Uint8Array)||preview.png.length<33||preview.png.length>8*1024*1024||
    !PNG.every((n,i)=>preview.png[i]===n))fail('PREVIEW_FAILED','A valid PNG preview is required for each native object.');
  const v=new DataView(preview.png.buffer,preview.png.byteOffset,preview.png.byteLength);
  const w=v.getUint32(16),h=v.getUint32(20);
  if(!w||!h||w>8192||h>8192||w*h>8_000_000)fail('RESOURCE_LIMIT','Invalid preview pixel bounds.');
  for(const k of ['widthPt','heightPt'])if(!Number.isFinite(preview[k])||preview[k]<=0||preview[k]>3000)
    fail('PREVIEW_FAILED','Invalid preview physical dimensions.');
  if(!Number.isFinite(preview.baselinePt)||preview.baselinePt<0||preview.baselinePt>preview.heightPt)
    fail('PREVIEW_FAILED','Invalid preview baseline.');
}
function relRoot(zip,path){
  const existing=zip.file(path);
  return existing?existing.async('string').then(parseXml):Promise.resolve(parseXml('<Relationships xmlns="'+NS.rel+'"/>'));
}
function newRelationship(doc,id,type,target){
  if(doc.documentElement.namespaceURI!==NS.rel)fail('INVALID_PACKAGE','Invalid relationship namespace.');
  const r=doc.createElementNS(NS.rel,'Relationship');r.setAttribute('Id',id);r.setAttribute('Type',NS.r+'/'+type);r.setAttribute('Target',target);
  doc.documentElement.appendChild(r);
}
function findRootText(root){return toArray(root.getElementsByTagNameNS(NS.w,'t')).map(n=>n.textContent);}
function makeObjectRun(doc,{oleId,imageId,shapeId,objectId,widthPt,heightPt,baselinePt}){
  const wr=doc.createElementNS(NS.w,'w:r'),rp=doc.createElementNS(NS.w,'w:rPr');
  const pos=doc.createElementNS(NS.w,'w:position');pos.setAttributeNS(NS.w,'w:val',String(-Math.round(baselinePt*2)));rp.appendChild(pos);wr.appendChild(rp);
  const object=doc.createElementNS(NS.w,'w:object');object.setAttributeNS(NS.w,'w:dxaOrig',String(Math.round(widthPt*20)));object.setAttributeNS(NS.w,'w:dyaOrig',String(Math.round(heightPt*20)));
  const shape=doc.createElementNS(NS.v,'v:shape');shape.setAttribute('id',shapeId);shape.setAttribute('type','#_x0000_t75');
  shape.setAttribute('style','width:'+widthPt.toFixed(4)+'pt;height:'+heightPt.toFixed(4)+'pt');shape.setAttributeNS(NS.o,'o:ole','');
  const image=doc.createElementNS(NS.v,'v:imagedata');image.setAttributeNS(NS.r,'r:id',imageId);image.setAttributeNS(NS.o,'o:title','');shape.appendChild(image);object.appendChild(shape);
  const ole=doc.createElementNS(NS.o,'o:OLEObject');
  for(const [key,value] of Object.entries({Type:'Embed',ProgID:'Equation.DSMT4',ShapeID:shapeId,DrawAspect:'Content',ObjectID:objectId}))ole.setAttribute(key,value);
  ole.setAttributeNS(NS.r,'r:id',oleId);object.appendChild(ole);wr.appendChild(object);
  return wr;
}
const shapeTypeXml=`<v:shapetype xmlns:v="${NS.v}" xmlns:o="${NS.o}" id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>`;
export async function convertDocxToMathType(input,options={}){
  aborted(options.signal);
  const source=input instanceof Blob?new Uint8Array(await input.arrayBuffer()):input instanceof Uint8Array?input.slice():new Uint8Array(input);
  if(!source.length||source.length>maxDocx)fail('RESOURCE_LIMIT','DOCX is empty or exceeds 24 MiB.');
  const zip=await JSZip.loadAsync(source,{checkCRC32:true});
  const entries=Object.values(zip.files);let expanded=0;
  if(entries.length>4096)fail('RESOURCE_LIMIT','Too many DOCX package parts.');
  for(const entry of entries){
    const original=entry.unsafeOriginalName||entry.name;
    if(original.startsWith('/')||original.split('/').includes('..')||original.includes('\\'))fail('INVALID_PACKAGE','Unsafe package path.');
    expanded+=Number(entry._data?.uncompressedSize||0);
    if(expanded>maxExpanded)fail('RESOURCE_LIMIT','DOCX expanded size exceeds 128 MiB.');
    if(/(?:^_xmlsignatures\/|vbaProject|^word\/(?:embeddings|activeX)\/)/i.test(original))
      fail('UNSUPPORTED_PACKAGE','Signed, macro-enabled or already embedded-object documents are not accepted by this converter.');
  }
  if(!zip.file('word/document.xml')||!zip.file('[Content_Types].xml'))fail('INVALID_PACKAGE','Missing DOCX document or content types.');
  const parts=Object.keys(zip.files).filter(p=>/^word\/[^/]+\.xml$/.test(p));
  const work=[],partData=[];let occurrence=0;
  const defaultSize=options.fontSizePt??13;
  // Complete structural preflight before creating ANY preview or output.
  for(const part of parts){
    const text=await zip.file(part).async('string');
    if(!text.includes(NS.m))continue;
    const doc=parseXml(text),equations=toArray(doc.getElementsByTagNameNS(NS.m,'oMath'));
    if(!equations.length)continue;
    if(doc.getElementsByTagNameNS(NS.o,'OLEObject').length)fail('UNSUPPORTED_PACKAGE','Mixed pre-existing OLE objects need separate qualification.');
    const nonMathText=findRootText(doc.documentElement);
    const rels=await relRoot(zip,relPath(part));
    const ids=toArray(rels.getElementsByTagNameNS(NS.rel,'Relationship')).map(n=>n.getAttribute('Id'));
    if(new Set(ids).size!==ids.length)fail('INVALID_PACKAGE','Duplicate relationship IDs.');
    const data={part,doc,rels,nonMathText,hasShapeType:toArray(doc.getElementsByTagNameNS(NS.v,'shapetype')).some(n=>n.getAttribute('id')==='_x0000_t75')};
    for(const eq of equations){
      if(++occurrence>2000)fail('RESOURCE_LIMIT','More than 2000 equations in one export.');
      if(occurrence===1||occurrence%8===0)await yieldMainThread(options.signal);
      let parent=eq.parentNode,replace=eq,display=false;
      if(parent?.namespaceURI===NS.m&&local(parent)==='oMathPara'){
        display=true;replace=parent;parent=parent.parentNode;
        if(elements(replace).filter(n=>local(n)==='oMath').length!==1)fail('UNSUPPORTED_OMML','Multiple equations in one math paragraph require qualification.');
      }
      if(parent?.namespaceURI!==NS.w||local(parent)!=='p')fail('UNSUPPORTED_OMML','Equation is not a direct paragraph child.');
      if(display&&elements(parent).some(n=>n!==replace&&local(n)!=='pPr'))fail('UNSUPPORTED_OMML','Mixed display math paragraph requires qualification.');
      try{
        const ast=ommlToAst(eq);
        const sizes=toArray(eq.getElementsByTagNameNS(NS.w,'sz')).map(n=>Number(n.getAttributeNS(NS.w,'val'))/2);
        const unique=[...new Set(sizes)];
        if(unique.length>1)fail('UNSUPPORTED_STYLE','Mixed explicit point sizes inside a formula are not supported.');
        const fontSizePt=unique[0]??defaultSize;
        const mtef=astToMtef(ast,{fontSizePt,display});
        work.push({partData:data,eq,replace,parent,display,ast,mtef,fontSizePt,index:occurrence,sourceXml:serialize(eq)});
      }catch(e){if(e instanceof MathTypeExportError){e.details={...e.details,part,equation:occurrence};}throw e;}
    }
    partData.push(data);
  }
  if(!work.length)return {blob:input instanceof Blob?input:new Blob([source],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),report:{converted:0,nativeEditorVerified:false,qualificationOnly:true}};
  const renderPreview=options.renderPreview;
  if(typeof renderPreview!=='function')fail('PREVIEW_REQUIRED','A qualified formula preview renderer is required.');
  const renderPreviewBatch=options.renderPreviewBatch;
  // Bound live PNG previews instead of retaining every preview until all
  // images are ready. The former 180s deadline covered the *entire* export:
  // a healthy export with hundreds of equations could time out mid-progress.
  const previewWindowSize=Math.max(1,Math.min(32,Math.floor(Number(options.previewWindowSize)||16)));
  let previewWindow=[],previewWindowEnd=0,previewCached=0;
  async function loadPreviewWindow(start){
    const pending=work.slice(start,start+previewWindowSize);
    const controller=new AbortController();
    const stop=()=>controller.abort(options.signal?.reason);
    if(options.signal?.aborted)aborted(options.signal);
    options.signal?.addEventListener('abort',stop,{once:true});
    const timeoutMs=Math.max(15000,Math.min(180000,
      Number(options.previewBatchTimeoutMs)||Math.max(45000,pending.length*4000)));
    let timeout,windowCached=0,rejectStall,settled=false;
    // This is a NO-PROGRESS watchdog, not an elapsed-time deadline.
    // Successful activity renews the timer; a huge but healthy export cannot
    // be rejected solely because it has been running for over 180 seconds.
    const stallPromise=new Promise((_,reject)=>{rejectStall=reject;});
    const armWatchdog=()=>{
      if(settled)return;
      clearTimeout(timeout);
      timeout=setTimeout(()=>{
        controller.abort();
        rejectStall(new MathTypeExportError('PREVIEW_BATCH_TIMEOUT',
          'Nhóm MathType '+(start+1)+'-'+(start+pending.length)+' ngừng phản hồi.',
          {total:work.length,index:start+1,windowSize:pending.length}));
      },timeoutMs);
    };
    try{
      armWatchdog();
      const previews=await Promise.race([
        Promise.resolve().then(()=>renderPreviewBatch(pending.map(item=>({
          ast:item.ast,fontSizePt:item.fontSizePt,display:item.display,index:item.index
        })),{
          signal:controller.signal,
          onProgress:({completed=0,cached=0}={})=>{
            if(settled||controller.signal.aborted)return;
            armWatchdog();
            windowCached=Math.max(windowCached,cached);
            options.onPreviewProgress?.({
              completed:start+Math.max(0,Math.min(pending.length,completed)),
              total:work.length,cached:previewCached+windowCached
            });
          }
        })),
        stallPromise
      ]);
      aborted(options.signal);
      if(!Array.isArray(previews)||previews.length!==pending.length)
        fail('PREVIEW_FAILED','Số ảnh xem trước MathType trong nhóm không khớp số công thức.');
      for(const preview of previews)pngCheck(preview);
      previewCached+=windowCached;
      options.onPreviewProgress?.({completed:start+pending.length,total:work.length,cached:previewCached});
      return previews;
    }catch(e){
      if(e instanceof MathTypeExportError)
        e.details={...e.details,total:work.length,index:e.details?.index||start+1};
      throw e;
    }finally{
      settled=true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort',stop);
    }
  }
  const originalHash=await sha256(source),manifest=[];
  for(let i=0;i<work.length;i++){
    aborted(options.signal);
    if(i===0||i%4===0)await yieldMainThread(options.signal);
    const item=work[i];const {doc,rels}=item.partData;
    if(typeof renderPreviewBatch==='function' && i>=previewWindowEnd){
      previewWindow=await loadPreviewWindow(i);
      previewWindowEnd=i+previewWindow.length;
    }
    let preview=typeof renderPreviewBatch==='function'
      ? previewWindow[i-(previewWindowEnd-previewWindow.length)] : null;
    if(!preview){
      try {
        const timeoutMs=Math.max(3000,Math.min(30000,Number(options.previewTimeoutMs||12000)));
        preview=await Promise.race([
          renderPreview(item.ast,{fontSizePt:item.fontSizePt,display:item.display,signal:options.signal}),
          new Promise((_,reject)=>setTimeout(()=>reject(new MathTypeExportError(
            'PREVIEW_TIMEOUT',
            'Quá thời gian tạo ảnh xem trước MathType cho công thức '+item.index+'.',
            {part:item.part,index:item.index}
          )),timeoutMs))
        ]);
        pngCheck(preview);
      } catch (e) {
        if(e instanceof MathTypeExportError){
          e.details={...e.details,part:item.part,index:item.index,total:work.length};
        }
        throw e;
      }
    }
    const native=createMathTypeOle(item.mtef);
    let suffix=item.index;let olePath,imagePath;
    do{olePath='word/embeddings/kttt-mathtype-'+suffix+'.bin';imagePath='word/media/kttt-mathtype-'+suffix+'.png';suffix++;}
    while(zip.file(olePath)||zip.file(imagePath));
    const oleId=freeId(rels,'Relationship','Id','rIdKtttMt',item.index*2),imageId=freeId(rels,'Relationship','Id','rIdKtttPreview',item.index*2+1);
    const shapeId=freeId(doc,'shape','id','_x0000_i',10000+item.index),objectId=freeId(doc,'OLEObject','ObjectID','_KTTT_MT_',item.index);
    const maxWidth=options.maxWidthPt??450,scale=Math.min(1,maxWidth/preview.widthPt);
    if(!Number.isFinite(maxWidth)||maxWidth<50||maxWidth>1000)fail('INVALID_SIZE','Invalid maximum formula width.');
    const run=makeObjectRun(doc,{oleId,imageId,shapeId,objectId,widthPt:preview.widthPt*scale,heightPt:preview.heightPt*scale,baselinePt:preview.baselinePt*scale});
    if(!item.partData.hasShapeType){
      run.lastChild.insertBefore(doc.importNode(parseXml(shapeTypeXml).documentElement,true),run.lastChild.firstChild);
      item.partData.hasShapeType=true;
    }
    if(item.display){
      const mp=elements(item.replace).find(n=>local(n)==='oMathParaPr');
      {
        if(elements(mp).some(n=>n.namespaceURI!==NS.m||local(n)!=='jc'))fail('UNSUPPORTED_OMML','Unknown display-math paragraph property.');
        const jc=elements(mp)[0],rawAlignment=jc?.getAttributeNS(NS.m,'val')||'center';
        const alignment=rawAlignment==='centerGroup'?'center':rawAlignment;
        if(!['center','left','right'].includes(alignment))fail('UNSUPPORTED_OMML','Unsupported display-math justification.');
        let ppr=elements(item.parent).find(n=>n.namespaceURI===NS.w&&local(n)==='pPr');
        if(!ppr){ppr=doc.createElementNS(NS.w,'w:pPr');item.parent.insertBefore(ppr,item.parent.firstChild);}
        let wjc=elements(ppr).find(n=>local(n)==='jc');if(!wjc){wjc=doc.createElementNS(NS.w,'w:jc');ppr.appendChild(wjc);}wjc.setAttributeNS(NS.w,'w:val',alignment);
      }
    }
    item.parent.replaceChild(run,item.replace);
    newRelationship(rels,oleId,'oleObject',olePath.slice(5));newRelationship(rels,imageId,'image',imagePath.slice(5));
    zip.file(olePath,native);zip.file(imagePath,preview.png);
    const [sourceSha256,mtefSha256,oleSha256,previewSha256]=await Promise.all([
      sha256(utf8(item.sourceXml)),sha256(item.mtef),sha256(native),sha256(preview.png)
    ]);
    manifest.push({index:item.index,part:item.partData.part,sourceSha256,mtefSha256,oleSha256,previewSha256,olePath,imagePath});
    options.onProgress?.({completed:i+1,total:work.length});
    // Release this entire window after its objects are packaged into ZIP.
    if(i+1===previewWindowEnd){previewWindow=[];previewWindowEnd=0;}
  }
  for(const data of partData){
    if(data.doc.getElementsByTagNameNS(NS.m,'oMath').length)fail('INCOMPLETE_CONVERSION','Unconverted Equation remains in output.');
    if(JSON.stringify(findRootText(data.doc.documentElement))!==JSON.stringify(data.nonMathText))fail('CONTENT_CHANGED','Non-math Word text changed. Export was cancelled.');
    zip.file(data.part,serialize(data.doc));zip.file(relPath(data.part),serialize(data.rels));
  }
  const types=parseXml(await zip.file('[Content_Types].xml').async('string'));
  if(types.documentElement.namespaceURI!==NS.ct)fail('INVALID_PACKAGE','Wrong content types namespace.');
  for(const [extension,contentType] of [['bin','application/vnd.openxmlformats-officedocument.oleObject'],['png','image/png']]){
    const matches=elements(types.documentElement).filter(n=>local(n)==='Default'&&n.getAttribute('Extension')===extension);
    if(matches.length>1||matches.length===1&&matches[0].getAttribute('ContentType')!==contentType)fail('INVALID_PACKAGE','Conflicting content type.');
    if(!matches.length){const d=types.createElementNS(NS.ct,'Default');d.setAttribute('Extension',extension);d.setAttribute('ContentType',contentType);types.documentElement.appendChild(d);}
  }
  zip.file('[Content_Types].xml',serialize(types));
  const report={version:1,qualificationOnly:true,nativeEditorVerified:false,converted:work.length,originalSha256:originalHash,equations:manifest};
  // Returned report is not hidden in the user's DOCX and contains no answers.
  aborted(options.signal);
  // Level 3 substantially reduces browser CPU time for formula-heavy DOCX files.
  // PNG previews are already compressed; raising DEFLATE further gives little value.
  const output=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}});
  if(output.length>maxExpanded)fail('RESOURCE_LIMIT','Converted DOCX is too large.');
  return {blob:new Blob([output],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),report};
}
