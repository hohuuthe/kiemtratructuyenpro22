/** Independent TEST decoder of CFB chains and directory tree; no exporter imports. */
import assert from 'node:assert/strict';
export function inspectOle(bytes){
  const b=Buffer.from(bytes),u32=o=>b.readUInt32LE(o),END=0xfffffffe,FREE=0xffffffff;
  assert.equal(b.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
  assert.equal(b.readUInt16LE(26),3);assert.equal(b.readUInt16LE(28),0xfffe);assert.equal(b.readUInt16LE(30),9);assert.equal(b.readUInt16LE(32),6);
  const total=b.length/512-1;assert.ok(Number.isInteger(total));
  const sector=i=>{assert.ok(Number.isInteger(i)&&i>=0&&i<total,'sector '+i);return b.subarray((i+1)*512,(i+2)*512);};
  const fat=[];for(let i=0;i<u32(44);i++){const block=sector(u32(76+i*4));for(let j=0;j<512;j+=4)fat.push(block.readUInt32LE(j));}
  const chain=(start,next,chunk,limit)=>{const out=[],seen=new Set();let at=start;while(at!==END){assert.ok(!seen.has(at)&&at!==FREE,'invalid chain');seen.add(at);out.push(chunk(at));at=next[at];assert.ok(out.length<=Math.ceil(limit/64)+2);}return Buffer.concat(out);};
  const dir=chain(u32(48),fat,sector,16384);const entries=[];
  for(let i=0;i<dir.length;i+=128){const type=dir[i+66];if(!type)continue;const len=dir.readUInt16LE(i+64);assert.ok(len>=2&&len<=64&&len%2===0);entries.push({id:i/128,name:dir.subarray(i,i+len-2).toString('utf16le'),type,color:dir[i+67],left:dir.readUInt32LE(i+68),right:dir.readUInt32LE(i+72),child:dir.readUInt32LE(i+76),clsid:dir.subarray(i+80,i+96).toString('hex'),start:dir.readUInt32LE(i+116),size:dir.readUInt32LE(i+120)});}
  const root=entries[0];assert.equal(root.type,5);assert.equal(root.clsid,'03ce020000000000c000000000000046');
  const cmp=(a,b)=>a.length-b.length||(a.toUpperCase()<b.toUpperCase()?-1:a===b?0:1),visited=new Set();
  function rb(id,low,high){if(id===FREE)return 1;const e=entries[id];assert.ok(e&&!visited.has(id));visited.add(id);assert.ok(!low||cmp(e.name,low)>0);assert.ok(!high||cmp(e.name,high)<0);if(e.color===0)for(const c of [e.left,e.right])assert.ok(c===FREE||entries[c].color===1);const left=rb(e.left,low,e.name),right=rb(e.right,e.name,high);assert.equal(left,right,'red-black depth');return left+(e.color===1?1:0);}
  assert.equal(entries[root.child].color,1);rb(root.child);assert.equal(visited.size,entries.length-1);
  const mfBytes=chain(u32(60),fat,sector,65536);const mf=[];for(let i=0;i<mfBytes.length;i+=4)mf.push(mfBytes.readUInt32LE(i));
  const miniRoot=chain(root.start,fat,sector,4*1024*1024).subarray(0,root.size),streams={};
  for(const e of entries.slice(1)){
    const raw=e.size<4096?chain(e.start,mf,i=>{assert.ok(i*64+64<=miniRoot.length);return miniRoot.subarray(i*64,(i+1)*64);},e.size):chain(e.start,fat,sector,e.size);
    assert.ok(raw.length>=e.size);streams[e.name]=raw.subarray(0,e.size);
  }
  assert.deepEqual(Object.keys(streams).sort(),['\x01CompObj','\x01Ole','\x03ObjInfo','Equation Native'].sort());
  const native=streams['Equation Native'];assert.equal(native.readUInt16LE(0),28);assert.equal(native.readUInt32LE(2),0x00020000);assert.equal(native.readUInt32LE(8)+28,native.length);
  return {streams,mtef:native.subarray(28),entries,fat};
}
/** Parse MTEF records separately to validate slot order and encoded glyphs. */
export function readMtef(bytes){
  const b=Buffer.from(bytes);let at=0;const byte=()=>{assert.ok(at<b.length,'truncated');return b[at++];},word=()=>byte()|(byte()<<8),str=()=>{let s='';for(let i=0;i<256;i++){const c=byte();if(!c)return s;s+=String.fromCharCode(c);}assert.fail('string');};
  assert.equal(byte(),5);byte();byte();byte();byte();str();byte();
  const dims=()=>{const count=byte();let low=-1;const nib=()=>{if(low>=0){const r=low;low=-1;return r;}const c=byte();low=c&15;return c>>4;};for(let i=0;i<count;i++){assert.ok(nib()<=4);let n=0;while(nib()!==15)assert.ok(++n<64);}if(low>=0)assert.equal(low,0);};
  function list(depth=0){assert.ok(depth<40);const out=[];for(;;){const type=byte();if(!type)return out;if(type>=10&&type<=14)continue;
    if(type===17){byte();str();continue;}if(type===18){assert.equal(byte(),0);dims();dims();const n=byte();for(let i=0;i<n;i++){if(byte())byte();}continue;}
    if(type===9){assert.equal(byte(),101);word();continue;}
    const options=byte();assert.ok([0,1].includes(options));
    if(type===1){out.push({k:'line',null:options===1,children:options===1?[]:list(depth+1)});continue;}
    if(type===2){out.push({k:'char',face:byte()-128,code:word()});continue;}
    if(type===3){const selector=byte(),lo=byte(),variation=lo&128?(lo&127)|(byte()<<8):lo,flags=byte();out.push({k:'template',selector,variation,flags,children:list(depth+1)});continue;}
    if(type===4){out.push({k:'pile',h:byte(),v:byte(),children:list(depth+1)});continue;}
    if(type===5){const v=byte(),h=byte(),cv=byte(),rows=byte(),cols=byte();for(let i=0;i<Math.ceil((rows+1)/4)+Math.ceil((cols+1)/4);i++)assert.equal(byte(),0);const cells=list(depth+1);assert.equal(cells.length,rows*cols);out.push({k:'matrix',rows,cols,h,v,cv,cells});continue;}
    assert.fail('unexpected record '+type);
  }}
  const tree=list();assert.equal(at,b.length);assert.equal(tree.length,1);return tree[0];
}
export const glyphs=n=>n.k==='char'?String.fromCharCode(n.code):(n.children||n.cells||[]).map(glyphs).join('');
