import jsQR from 'jsqr';
import { parseQrCardPayload } from './qr-card-orientation.js';

function dedupe(items){
  const byToken=new Map();
  for(const d of items||[]){
    const token=String(d?.cardToken||'');
    if(!token)continue;
    const p=d.location;
    const area=p?Math.abs(
      (p.topRightCorner.x-p.topLeftCorner.x)*(p.bottomLeftCorner.y-p.topLeftCorner.y)-
      (p.topRightCorner.y-p.topLeftCorner.y)*(p.bottomLeftCorner.x-p.topLeftCorner.x)
    ):0;
    const prev=byToken.get(token);
    if(!prev||area>prev.area)byToken.set(token,{d,area});
  }
  return [...byToken.values()].map(x=>x.d);
}
function maskCode(data,width,height,location,pad=10){
  const pts=[location?.topLeftCorner,location?.topRightCorner,location?.bottomRightCorner,location?.bottomLeftCorner].filter(Boolean);
  if(!pts.length)return;
  const minX=Math.max(0,Math.floor(Math.min(...pts.map(p=>p.x))-pad));
  const maxX=Math.min(width-1,Math.ceil(Math.max(...pts.map(p=>p.x))+pad));
  const minY=Math.max(0,Math.floor(Math.min(...pts.map(p=>p.y))-pad));
  const maxY=Math.min(height-1,Math.ceil(Math.max(...pts.map(p=>p.y))+pad));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const i=(y*width+x)*4;
    data[i]=data[i+1]=data[i+2]=255;data[i+3]=255;
  }
}
function decodeMultiple(data,width,height,maxCodes=16,inversionAttempts='dontInvert'){
  const work=new Uint8ClampedArray(data);
  const out=[];
  for(let i=0;i<maxCodes;i++){
    const qr=jsQR(work,width,height,{inversionAttempts});
    if(!qr?.data||!qr?.location)break;
    const parsed=parseQrCardPayload(qr.data);
    if(parsed)out.push({data:qr.data,cardToken:parsed.cardToken,location:qr.location});
    maskCode(work,width,height,qr.location,12);
  }
  return out;
}
function cropScale(src,srcW,srcH,x0,y0,w,h,scale){
  const tw=Math.max(1,Math.round(w*scale)),th=Math.max(1,Math.round(h*scale));
  const out=new Uint8ClampedArray(tw*th*4);
  for(let y=0;y<th;y++){
    const sy=Math.min(srcH-1,Math.max(0,Math.floor(y0+y/scale)));
    for(let x=0;x<tw;x++){
      const sx=Math.min(srcW-1,Math.max(0,Math.floor(x0+x/scale)));
      const si=(sy*srcW+sx)*4,di=(y*tw+x)*4;
      out[di]=src[si];out[di+1]=src[si+1];out[di+2]=src[si+2];out[di+3]=src[si+3];
    }
  }
  return {data:out,width:tw,height:th};
}
function mapLocation(location,x0,y0,scale){
  const conv=p=>({x:x0+(Number(p.x)||0)/scale,y:y0+(Number(p.y)||0)/scale});
  return {
    topLeftCorner:conv(location.topLeftCorner),
    topRightCorner:conv(location.topRightCorner),
    bottomRightCorner:conv(location.bottomRightCorner),
    bottomLeftCorner:conv(location.bottomLeftCorner)
  };
}

self.onmessage=e=>{
  const msg=e.data||{};
  if(msg.type!=='decode')return;
  const started=performance.now();
  try{
    const width=Math.max(1,Number(msg.width)||1),height=Math.max(1,Number(msg.height)||1);
    const src=new Uint8ClampedArray(msg.buffer);
    const cycle=Math.max(0,Number(msg.cycle)||0);
    const far=msg.mode==='far';
    const tier=['high','balanced','safe'].includes(msg.performanceTier)?msg.performanceTier:'balanced';
    const maxCodes=Math.max(16,Math.min(80,Number(msg.maxCodes)||60));
    const inversion=cycle%5===0?'attemptBoth':'dontInvert';
    const all=decodeMultiple(src,width,height,Math.min(18,maxCodes),inversion);

    const cols=far?(width>=1500?4:3):(width>=1400?3:2);
    const rows=far?(height>=800?3:2):(height>=700?3:2);
    const overlap=far?.28:.20;
    const tileW=width/cols,tileH=height/rows,total=cols*rows;
    const budgetByTier=far
      ? {high:9,balanced:7,safe:5}
      : {high:6,balanced:5,safe:4};
    const budget=Math.min(total,budgetByTier[tier]);
    const offset=(cycle*budget)%Math.max(1,total);
    const upscaleByTier=far
      ? {high:(width>=1500?2.35:2.05),balanced:1.9,safe:1.65}
      : {high:(width>=1400?1.9:1.55),balanced:1.5,safe:1.3};
    const upscale=upscaleByTier[tier];

    for(let n=0;n<budget&&all.length<maxCodes;n++){
      const idx=(offset+n)%total,ry=Math.floor(idx/cols),cx=idx%cols;
      const x0=Math.max(0,Math.floor(cx*tileW-tileW*overlap/2));
      const y0=Math.max(0,Math.floor(ry*tileH-tileH*overlap/2));
      const x1=Math.min(width,Math.ceil((cx+1)*tileW+tileW*overlap/2));
      const y1=Math.min(height,Math.ceil((ry+1)*tileH+tileH*overlap/2));
      const crop=cropScale(src,width,height,x0,y0,x1-x0,y1-y0,upscale);
      const found=decodeMultiple(crop.data,crop.width,crop.height,far?8:6,inversion);
      for(const d of found)all.push({...d,location:mapLocation(d.location,x0,y0,upscale)});
    }
    self.postMessage({type:'decoded',frameId:msg.frameId,cycle,cameraEpoch:msg.cameraEpoch,sessionId:msg.sessionId,questionId:msg.questionId,stateRevision:msg.stateRevision,detections:dedupe(all).slice(0,maxCodes),durationMs:performance.now()-started,width,height});
  }catch(error){
    self.postMessage({type:'decode-error',frameId:msg.frameId,message:String(error?.message||error)});
  }
};
