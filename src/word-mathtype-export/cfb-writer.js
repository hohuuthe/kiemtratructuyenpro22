/**
 * Minimal CFB v3 writer for DATA-ONLY MathType objects (MS-CFB / MS-OLEDS).
 * Never copies an OLE file from an uploaded document. Creates four known streams.
 * This is not a Microsoft Word/MathType native-application acceptance test.
 */
import {fail} from './errors.js';
const FREE=0xffffffff, END=0xfffffffe, FAT=0xfffffffd, SECTOR=512, MINI=64;
const clsid=Uint8Array.from([3,0xce,2,0,0,0,0,0,0xc0,0,0,0,0,0,0,0x46]);
const dataView=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const concat=parts=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b;};
const uint32=n=>{const b=new Uint8Array(4);dataView(b).setUint32(0,n,true);return b;};
const ansi=s=>Uint8Array.from([...Array.from(s,c=>c.charCodeAt(0)),0]);
const ansiField=s=>{const b=ansi(s);return concat([uint32(b.length),b]);};
function compoundMetadata(){
  const h=new Uint8Array(28),v=dataView(h);v.setUint32(0,0xfffe0001,true);v.setUint32(4,0xa03,true);v.setUint32(8,FREE,true);h.set(clsid,12);
  return concat([h,ansiField('MathType Equation'),ansiField('MathType EF'),uint32(0),uint32(0x71b239f4),uint32(0),uint32(0),uint32(0)]);
}
export function createMathTypeOle(mtef) {
  if(!(mtef instanceof Uint8Array)||mtef.length<7||mtef.length>96*1024||mtef[0]!==5)
    fail('INVALID_MTEF','A bounded MTEF v5 equation is required.');
  const native=new Uint8Array(28+mtef.length),nv=dataView(native);
  nv.setUint16(0,28,true);nv.setUint32(2,0x00020000,true);
  // EQNOLEFILEHDR.cf identifies the registered "MathType EF" clipboard
  // format. Zero denotes no format and produces a malformed OLE native stream.
  // 0xC1C6 is the MathType EF value used by LibreOffice's native EqnOLE writer.
  // This is not a Word/MathType desktop acceptance substitute.
  nv.setUint16(6,0xc1c6,true);nv.setUint32(8,mtef.length,true);
  // Reserved header values specified by the WIRIS Equation Native format.
  nv.setUint32(16,0x0014f690,true);nv.setUint32(20,0x0014ebb4,true);native.set(mtef,28);
  const oleHeader=new Uint8Array(20);dataView(oleHeader).setUint32(0,0x02000001,true);
  const entries=[{name:'\u0001CompObj',bytes:compoundMetadata()},
    {name:'\u0001Ole',bytes:oleHeader},{name:'\u0003ObjInfo',bytes:Uint8Array.from([0,0,3,0,4,0])},
    {name:'Equation Native',bytes:native}];
  // CFB directory sorting: UTF-16 name length, then uppercase comparison.
  entries.sort((a,b)=>a.name.length-b.name.length||(a.name.toUpperCase()<b.name.toUpperCase()?-1:1));
  const miniChunks=[],miniFat=[];
  for(const e of entries)if(e.bytes.length<4096){
    e.mini=true;e.start=miniFat.length;
    const n=Math.ceil(e.bytes.length/MINI),p=new Uint8Array(n*MINI);p.set(e.bytes);miniChunks.push(p);
    for(let i=0;i<n;i++)miniFat.push(i===n-1?END:e.start+i+1);
  }
  const rootData=concat(miniChunks),sectors=[],fat=[];
  function allocate(bytes){
    if(!bytes.length)return END;
    const first=sectors.length,n=Math.ceil(bytes.length/SECTOR);
    for(let i=0;i<n;i++){const chunk=new Uint8Array(SECTOR);chunk.set(bytes.subarray(i*SECTOR,(i+1)*SECTOR));sectors.push(chunk);fat.push(i===n-1?END:first+i+1);}
    return first;
  }
  const directory=new Uint8Array(Math.ceil((entries.length+1)*128/SECTOR)*SECTOR);
  const directoryStart=allocate(directory);
  const mf=new Uint8Array(Math.ceil(miniFat.length/128)*SECTOR);mf.fill(255);const mfv=dataView(mf);
  miniFat.forEach((v,i)=>mfv.setUint32(i*4,v,true));
  const miniFatStart=allocate(mf),rootStart=allocate(rootData);
  for(const e of entries)if(!e.mini)e.start=allocate(e.bytes);
  let fatCount=1;while(fatCount<Math.ceil((sectors.length+fatCount)/128))fatCount++;
  if(fatCount>109)fail('RESOURCE_LIMIT','OLE requires an unsupported extended FAT.');
  const fatStart=sectors.length;
  for(let i=0;i<fatCount;i++){const b=new Uint8Array(SECTOR);b.fill(255);sectors.push(b);fat.push(FAT);}
  fat.forEach((v,i)=>dataView(sectors[fatStart+Math.floor(i/128)]).setUint32((i%128)*4,v,true));
  function writeDirectory(index,name,type,start,size,left=FREE,right=FREE,child=FREE,color=1){
    const offset=index*128,v=dataView(directory);
    for(let i=0;i<name.length;i++)v.setUint16(offset+i*2,name.charCodeAt(i),true);
    v.setUint16(offset+64,(name.length+1)*2,true);v.setUint8(offset+66,type);v.setUint8(offset+67,color);
    v.setUint32(offset+68,left,true);v.setUint32(offset+72,right,true);v.setUint32(offset+76,child,true);
    if(type===5)directory.set(clsid,offset+80);
    v.setUint32(offset+116,start,true);v.setUint32(offset+120,size,true);
  }
  // Four-node red-black tree: 2(B) -> 1(B), 3(B) -> 4(R).
  writeDirectory(0,'Root Entry',5,rootStart,rootData.length,FREE,FREE,2);
  for(let i=0;i<4;i++){
    const idx=i+1,e=entries[i];
    writeDirectory(idx,e.name,2,e.start,e.bytes.length,idx===2?1:FREE,idx===2?3:idx===3?4:FREE,FREE,idx===4?0:1);
  }
  for(let i=0;i<directory.length/SECTOR;i++)sectors[directoryStart+i].set(directory.subarray(i*SECTOR,(i+1)*SECTOR));
  const head=new Uint8Array(SECTOR),h=dataView(head);
  head.set([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);h.setUint16(24,0x3e,true);h.setUint16(26,3,true);
  h.setUint16(28,0xfffe,true);h.setUint16(30,9,true);h.setUint16(32,6,true);
  h.setUint32(44,fatCount,true);h.setUint32(48,directoryStart,true);h.setUint32(56,4096,true);
  h.setUint32(60,miniFatStart,true);h.setUint32(64,mf.length/SECTOR,true);h.setUint32(68,END,true);
  for(let i=0;i<109;i++)h.setUint32(76+i*4,i<fatCount?fatStart+i:FREE,true);
  return concat([head,...sectors]);
}
