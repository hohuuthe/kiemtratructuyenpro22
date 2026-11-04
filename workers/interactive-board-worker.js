function b64urlDecode(value) {
  const s = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(value)));
}
async function verifyJwt(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h,p,s] = parts;
  let header, payload;
  try { header = decodeJsonPart(h); payload = decodeJsonPart(p); } catch { return null; }
  if (header?.alg !== 'HS256') return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(s), new TextEncoder().encode(h + '.' + p));
  if (!ok) return null;
  const now = Math.floor(Date.now()/1000);
  if (payload.exp && Number(payload.exp) <= now) return null;
  return payload;
}
function safeId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,120}$/.test(id) ? id : '';
}
function safeColor(value, fallback='#111827') {
  const v=String(value || fallback).trim();
  return /^#[0-9A-Fa-f]{6}$/.test(v) ? v : fallback;
}
function clamp(n,min,max,fallback=min) {
  const v=Number(n); return Number.isFinite(v) ? Math.max(min,Math.min(max,v)) : fallback;
}
function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.slice(0, 4000).map(p=>Array.isArray(p)&&p.length>=2
    ? [Math.round(clamp(p[0],-20000,20000,0)),Math.round(clamp(p[1],-20000,20000,0))]
    : null).filter(Boolean);
}
function normalizeObject(input, actor) {
  if (!input || typeof input !== 'object') return null;
  const id=safeId(input.id), pageId=safeId(input.pageId), type=String(input.type||'');
  if (!id || !pageId || !['stroke','text','note','rect','ellipse','line','arrow','image'].includes(type)) return null;
  const base={id,pageId,type,creatorId:String(actor?.userId||''),creatorName:String(actor?.displayName||'Người dùng').slice(0,100),creatorClass:String(actor?.studentClass||'').slice(0,100),creatorUnit:String(actor?.studentUnit||'').slice(0,180),creatorRole:String(actor?.displayRole||'student').slice(0,30),locked:input.locked===true,updatedAt:Date.now()};
  if (type==='stroke') {
    const points=normalizePoints(input.points).slice(0,1600);
    if (points.length<2) return null;
    return {...base,points,color:safeColor(input.color),width:clamp(input.width,1,24,3)};
  }
  if (type==='text'||type==='note') {
    return {...base,x:clamp(input.x,-20000,20000,0),y:clamp(input.y,-20000,20000,0),
      w:clamp(input.w,20,3000,220),h:clamp(input.h,20,3000,120),
      text:String(input.text||'').slice(0,2000),color:safeColor(input.color),fontSize:clamp(input.fontSize,10,96,20)};
  }
  if(type==='image'){
    const url=String(input.url||'').trim();
    if(!/^https:\/\//i.test(url)||url.length>2048)return null;
    return {...base,x:clamp(input.x,-20000,20000,0),y:clamp(input.y,-20000,20000,0),
      w:clamp(input.w,40,3000,640),h:clamp(input.h,40,3000,360),url,
      z:clamp(input.z,-10000,10000,0),background:input.background===true,fit:input.fit==='cover'?'cover':'contain'};
  }
  return {...base,x1:clamp(input.x1,-20000,20000,0),y1:clamp(input.y1,-20000,20000,0),
    x2:clamp(input.x2,-20000,20000,0),y2:clamp(input.y2,-20000,20000,0),
    color:safeColor(input.color),width:clamp(input.width,1,24,3)};
}
function stateOf(ws) {
  try { return ws.deserializeAttachment() || {}; } catch { return {}; }
}
function secureEqualString(a,b) {
  const aa=new TextEncoder().encode(String(a||'')),bb=new TextEncoder().encode(String(b||''));
  let diff=aa.length^bb.length;
  for(let i=0;i<Math.max(aa.length,bb.length);i++) diff|=(aa[i]||0)^(bb[i]||0);
  return diff===0;
}

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(request.method==='GET' && url.pathname==='/internal/health'){
      const secret=String(env.BOARD_REALTIME_SECRET||'');
      if(!secret||!secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret))return new Response('Unauthorized',{status:401});
      try{
        if(!env.BOARD_ROOM||typeof env.BOARD_ROOM.idFromName!=='function')return new Response('Durable Object binding unavailable',{status:503});
        const stub=env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('__health__'));
        const probe=await stub.fetch(new Request('https://board.internal/health',{
          method:'GET',headers:{'X-Board-Internal-Secret':secret}
        }));
        if(!probe.ok)return new Response('Durable Object health failed',{status:503});
        return new Response(JSON.stringify({ok:true,service:'interactive-board-realtime',durable_object:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
      }catch{return new Response('Durable Object unavailable',{status:503});}
    }
    if (request.method==='POST' && (url.pathname==='/internal/board-reset' || url.pathname==='/internal/board-policy' || url.pathname==='/internal/board-page-reset' || url.pathname==='/internal/board-page-created' || url.pathname==='/internal/board-page-updated' || url.pathname==='/internal/board-user-block')) {
      const secret=String(env.BOARD_REALTIME_SECRET || '');
      if (!secret || !secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret)) {
        return new Response('Unauthorized',{status:401});
      }
      let body;try{body=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
      const tenant=String(body?.tenant||''),boardId=safeId(body?.boardId);
      if(!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)||!boardId)return new Response('Invalid board',{status:400});
      const roomName=tenant+':'+boardId;
      const stub=env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(roomName));
      if(url.pathname==='/internal/board-reset'){
        return stub.fetch(new Request('https://board.internal/reset',{method:'POST',headers:{'X-Board-Internal-Secret':secret}}));
      }
      if(url.pathname==='/internal/board-user-block'){
        const targetUserId=safeId(body?.targetUserId);
        if(!targetUserId)return new Response('Invalid user',{status:400});
        return stub.fetch(new Request('https://board.internal/user-block',{
          method:'POST',headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
          body:JSON.stringify({targetUserId,blocked:body?.blocked===true})
        }));
      }
      if(url.pathname==='/internal/board-page-updated'){
        const page=body?.page;
        if(!page||!safeId(page.id))return new Response('Invalid page',{status:400});
        return stub.fetch(new Request('https://board.internal/page-updated',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
          body:JSON.stringify({page})
        }));
      }
      if(url.pathname==='/internal/board-page-created'){
        const page=body?.page;
        if(!page||!safeId(page.id))return new Response('Invalid page',{status:400});
        return stub.fetch(new Request('https://board.internal/page-created',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
          body:JSON.stringify({page})
        }));
      }
      if(url.pathname==='/internal/board-page-reset'){
        const pageId=safeId(body?.pageId);
        if(!pageId)return new Response('Invalid page',{status:400});
        return stub.fetch(new Request('https://board.internal/page-reset',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
          body:JSON.stringify({pageId})
        }));
      }
      const revision=Math.max(1,Number(body?.revision)||1);
      const locked=body?.locked===true;
      const unavailable=body?.unavailable===true;
      return stub.fetch(new Request('https://board.internal/policy',{
        method:'POST',
        headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
        body:JSON.stringify({revision,locked,unavailable})
      }));
    }
    const isWebSocket=(request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
    const isSnapshot=request.method==='GET' && url.searchParams.get('snapshot')==='1';
    if (!isWebSocket && !isSnapshot) return new Response('WebSocket required', {status:426});
    const token = url.searchParams.get('token') || '';
    const claims = await verifyJwt(token, String(env.BOARD_REALTIME_SECRET || ''));
    if (!claims || claims.tokenType !== 'board_join' || !safeId(claims.boardId) ||
        !safeId(claims.userId) || !/^[A-Za-z0-9_-]{1,64}$/.test(String(claims.tenant || ''))) {
      return new Response('Unauthorized', {status:401});
    }
    const roomName = String(claims.tenant) + ':' + String(claims.boardId);
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(roomName));
    return stub.fetch(request);
  }
};

export class BoardRoom {
  constructor(ctx, env) {
    this.ctx=ctx; this.env=env;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }

  async fetch(request) {
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health'){
      const secret=String(this.env.BOARD_REALTIME_SECRET||'');
      if(!secret||!secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret))return new Response('Unauthorized',{status:401});
      return new Response(JSON.stringify({ok:true,class:'BoardRoom'}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    if(request.method==='GET'&&url.searchParams.get('snapshot')==='1'){
      const token=url.searchParams.get('token')||'';
      const claims=await verifyJwt(token,String(this.env.BOARD_REALTIME_SECRET||''));
      if(!claims||claims.tokenType!=='board_join')return new Response('Unauthorized',{status:401});
      const signedPageId=safeId(claims.pageId||'');
      const allowedPages=(Array.isArray(claims.pageIds)?claims.pageIds:[signedPageId]).map(safeId).filter(Boolean).slice(0,20);
      const pageId=safeId(url.searchParams.get('pageId')||signedPageId);
      if(!pageId||!allowedPages.includes(pageId))return new Response('Forbidden',{status:403});
      if(await this.ctx.storage.get('deletedpage:'+pageId))return new Response('Page deleted',{status:410});
      const rows=await this.ctx.storage.list({prefix:'obj:'+pageId+':'});
      const objects=[...rows.values()].slice(0,600);
      return new Response(JSON.stringify({pageId,objects}),{
        headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
      });
    }
    if(request.method==='POST'&&url.pathname==='/user-block'){
      const secret=String(this.env.BOARD_REALTIME_SECRET || '');
      if(!secret||!secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret))return new Response('Unauthorized',{status:401});
      let body;try{body=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
      const targetUserId=safeId(body?.targetUserId),blocked=body?.blocked===true;
      if(!targetUserId)return new Response('Invalid user',{status:400});
      if(blocked){
        for(const socket of this.ctx.getWebSockets()){
          const s=stateOf(socket);if(s.userId!==targetUserId)continue;
          try{socket.send(JSON.stringify({type:'user_blocked'}));socket.close(4006,'Blocked from board')}catch{}
        }
        this.broadcast({type:'presence',participants:this.participants()});
      }
      return new Response('OK');
    }
    if(request.method==='POST'&&url.pathname==='/page-updated'){
      const secret=String(this.env.BOARD_REALTIME_SECRET || '');
      if(!secret||!secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret))return new Response('Unauthorized',{status:401});
      let body;try{body=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
      const page=body?.page;if(!page||!safeId(page.id))return new Response('Invalid page',{status:400});
      this.broadcast({type:'page_updated',page:{
        id:String(page.id),page_no:Number(page.page_no)||0,title:String(page.title||'').slice(0,100),
        background_type:String(page.background_type||'white'),background_image_url:String(page.background_image_url||'').slice(0,2048),canvas_width:1600,canvas_height:900,revision:Number(page.revision)||1
      }});
      return new Response('OK');
    }
    if(request.method==='POST'&&url.pathname==='/page-created'){
      const secret=String(this.env.BOARD_REALTIME_SECRET || '');
      if(!secret||!secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret))return new Response('Unauthorized',{status:401});
      let body;try{body=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
      const page=body?.page;if(!page||!safeId(page.id))return new Response('Invalid page',{status:400});
      await this.ctx.storage.delete('deletedpage:'+String(page.id));
      this.broadcast({type:'page_created',page:{
        id:String(page.id),page_no:Number(page.page_no)||0,title:String(page.title||'').slice(0,100),
        background_type:String(page.background_type||'white'),canvas_width:1600,canvas_height:900,revision:Number(page.revision)||1
      }});
      return new Response('OK');
    }
    if(request.method==='POST'&&url.pathname==='/page-reset'){
      const secret=String(this.env.BOARD_REALTIME_SECRET || '');
      if(!secret||!secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret))return new Response('Unauthorized',{status:401});
      let body;try{body=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
      const pageId=safeId(body?.pageId);if(!pageId)return new Response('Invalid page',{status:400});
      const rows=await this.ctx.storage.list({prefix:'obj:'+pageId+':'});
      if(rows.size)await this.ctx.storage.delete([...rows.keys()]);
      const voteRows=await this.ctx.storage.list({prefix:'vote:'+pageId+':'});
      if(voteRows.size)await this.ctx.storage.delete([...voteRows.keys()]);
      await this.ctx.storage.delete(['count:'+pageId,'points:'+pageId]);
      await this.ctx.storage.put('deletedpage:'+pageId,true);
      this.broadcast({type:'page_deleted',pageId});
      for(const socket of this.ctx.getWebSockets(pageId)){try{socket.close(4005,'Page deleted')}catch{}}
      return new Response('OK');
    }
    if(request.method==='POST'&&url.pathname==='/policy'){
      const secret=String(this.env.BOARD_REALTIME_SECRET || '');
      if(!secret||!secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret))return new Response('Unauthorized',{status:401});
      let body;try{body=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
      const revision=Math.max(1,Number(body?.revision)||1),unavailable=body?.unavailable===true;
      const hasLocked=typeof body?.locked==='boolean';
      const previousLocked=Boolean(await this.ctx.storage.get('room:locked'));
      const locked=hasLocked?body.locked===true:previousLocked;
      const state={'room:boardRevision':revision};
      if(hasLocked)state['room:locked']=locked;
      await this.ctx.storage.put(state);
      const event=unavailable?{type:'board_unavailable'}:{type:'policy_changed',locked};
      for(const socket of this.ctx.getWebSockets()){
        try{socket.send(JSON.stringify(event));socket.close(4003,'Board policy changed')}catch{}
      }
      return new Response('OK');
    }
    if(request.method==='POST'&&url.pathname==='/reset'){
      const secret=String(this.env.BOARD_REALTIME_SECRET || '');
      if(!secret||!secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret))return new Response('Unauthorized',{status:401});
      for(const socket of this.ctx.getWebSockets()){try{socket.send(JSON.stringify({type:'board_deleted'}));socket.close(4004,'Board deleted')}catch{}}
      await this.ctx.storage.deleteAll();
      return new Response('OK');
    }
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('WebSocket required',{status:426});
    const token=url.searchParams.get('token')||'';
    const claims=await verifyJwt(token,String(this.env.BOARD_REALTIME_SECRET || ''));
    if (!claims || claims.tokenType!=='board_join') return new Response('Unauthorized',{status:401});
    const boardId=safeId(claims.boardId), userId=safeId(claims.userId);
    const signedPageId=safeId(claims.pageId || '');
    const allowedPages=(Array.isArray(claims.pageIds)?claims.pageIds:[signedPageId]).map(safeId).filter(Boolean).slice(0,20);
    const requestedPageId=safeId(url.searchParams.get('pageId') || signedPageId);
    if (!boardId || !userId || !signedPageId || !requestedPageId || !allowedPages.includes(requestedPageId)) {
      return new Response('Invalid room parameters',{status:403});
    }
    if(await this.ctx.storage.get('deletedpage:'+requestedPageId))return new Response('Page deleted',{status:410});
    const pageId=requestedPageId;
    const sockets=this.ctx.getWebSockets();
    const max=clamp(claims.maxParticipants,1,120,60);
    const sameUser=sockets.filter(ws=>stateOf(ws).userId===userId);
    if (sameUser.length>=3) return new Response('Too many connections for this account',{status:429});
    const distinctUsers=new Set(sockets.map(ws=>stateOf(ws).userId).filter(Boolean));
    if (!distinctUsers.has(userId) && distinctUsers.size>=max) return new Response('Room full',{status:429});

    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    const userLocked=claims.role==='student' && Boolean(await this.ctx.storage.get('userlock:'+userId));
    const attachment={
      boardId,userId,pageId,
      displayName:String(claims.displayName||'Người dùng').slice(0,100),
      role:String(claims.role||'student'),
      displayRole:String(claims.displayRole||'student'),
      studentClass:String(claims.studentClass||'').slice(0,100),
      studentUnit:String(claims.studentUnit||'').slice(0,180),
      permission:String(claims.permission||'view'),
      blocked:userLocked,
      allowedPages,
      activeStrokes:[],
      tokenExp:Math.max(0,Number(claims.exp)||0),
      joinedAt:Date.now()
    };
    this.ctx.acceptWebSocket(server,[pageId]);
    server.serializeAttachment(attachment);

    const incomingRevision=Math.max(1,Number(claims.boardRevision)||1);
    const storedRevision=Math.max(0,Number(await this.ctx.storage.get('room:boardRevision'))||0);
    let lockedRaw=await this.ctx.storage.get('room:locked');
    if(incomingRevision>storedRevision){
      lockedRaw=claims.initialLocked===true;
      await this.ctx.storage.put({'room:boardRevision':incomingRevision,'room:locked':Boolean(lockedRaw)});
    }else if(lockedRaw===undefined){
      lockedRaw=claims.initialLocked===true;
      if(lockedRaw)await this.ctx.storage.put('room:locked',true);
    }
    const locked=Boolean(lockedRaw);
    const objects=await this.ctx.storage.list({prefix:'obj:'+pageId+':'});
    const snapshot=[...objects.values()].slice(0,600);
    const participants=this.participants();
    let timer=await this.ctx.storage.get('room:timer')||null;
    if(timer?.endAt&&Number(timer.endAt)<=Date.now()){await this.ctx.storage.delete('room:timer');timer=null;}
    server.send(JSON.stringify({type:'snapshot_begin',pageId,locked,userLocked,total:snapshot.length,participants,timer}));
    for(let i=0;i<snapshot.length;i+=100){
      server.send(JSON.stringify({type:'snapshot_chunk',pageId,objects:snapshot.slice(i,i+100)}));
    }
    server.send(JSON.stringify({type:'snapshot_end',pageId}));
    this.broadcast({type:'presence',participants},server);
    return new Response(null,{status:101,webSocket:client});
  }

  participants() {
    const seen=new Map(),now=Math.floor(Date.now()/1000);
    for (const ws of this.ctx.getWebSockets()) {
      const s=stateOf(ws);
      if (!s.userId) continue;
      if(s.tokenExp&&now>=Number(s.tokenExp)){try{ws.close(4001,'Token expired')}catch{};continue;}
      if (!seen.has(s.userId)) seen.set(s.userId,{
        userId:s.userId,displayName:s.displayName||'Người dùng',role:s.displayRole||'student',
        blocked:Boolean(s.blocked),pageId:s.pageId||'',studentClass:s.studentClass||'',studentUnit:s.studentUnit||''
      });
    }
    return [...seen.values()].slice(0,120);
  }

  broadcast(payload, except=null, pageId='') {
    const text=JSON.stringify(payload),now=Math.floor(Date.now()/1000);
    const sockets=pageId ? this.ctx.getWebSockets(pageId) : this.ctx.getWebSockets();
    for (const socket of sockets) {
      if (socket===except || socket.readyState!==WebSocket.OPEN) continue;
      const s=stateOf(socket);
      if(s.tokenExp&&now>=Number(s.tokenExp)){try{socket.close(4001,'Token expired')}catch{};continue;}
      try { socket.send(text); } catch {}
    }
  }

  async webSocketMessage(ws,message) {
    const actor=stateOf(ws);
    if (!actor.userId || typeof message!=='string' || message.length>65536) return;
    if(actor.tokenExp && Math.floor(Date.now()/1000)>=Number(actor.tokenExp)){
      try{ws.send(JSON.stringify({type:'token_expired'}));ws.close(4001,'Token expired')}catch{}
      return;
    }
    let packet; try { packet=JSON.parse(message); } catch { return; }
    if (!packet || packet.type!=='op_batch' || !Array.isArray(packet.ops) || packet.ops.length>80) return;
    const clientOpId=safeId(packet.clientOpId);
    const recentKey=clientOpId?'recentops:'+actor.userId:'';
    let durableRecent=[];
    if(clientOpId){
      const stored=await this.ctx.storage.get(recentKey);
      durableRecent=Array.isArray(stored)?stored:[];
      if(durableRecent.includes(clientOpId)){
        try{ws.send(JSON.stringify({type:'op_ack',clientOpId,duplicate:true}))}catch{}
        return;
      }
    }
    const now=Date.now(),windowStart=Number(actor.rateWindowStart||0);
    if(!windowStart||now-windowStart>10000){actor.rateWindowStart=now;actor.rateOps=0;}
    const nextOps=Number(actor.rateOps||0)+packet.ops.length;
    if(nextOps>400){
      actor.rateOps=nextOps;ws.serializeAttachment(actor);
      try{ws.send(JSON.stringify({type:'rate_limited',clientOpId:clientOpId||'',retryAfterMs:Math.max(250,10000-(now-Number(actor.rateWindowStart||now))) }))}catch{}
      return;
    }
    actor.rateOps=nextOps;
    ws.serializeAttachment(actor);
    const roomLocked=Boolean(await this.ctx.storage.get('room:locked'));
    // Quyền quản lý chỉ đến từ claim permission=manage do Pages API cấp sau khi kiểm tra owner/admin.
    // Không suy quyền quản lý trực tiếp từ role vì giáo viên có thể tham gia bảng của giáo viên khác như một người tham gia thường.
    const canManage=actor.permission==='manage';
    const userBlocked=!canManage && Boolean(actor.blocked);
    const canDraw=canManage || (!roomLocked && !userBlocked && actor.permission==='draw');
    const canComment=canManage || (!roomLocked && !userBlocked && ['draw','comment'].includes(actor.permission));
    const canVote=canManage || (!roomLocked && !userBlocked && ['draw','comment'].includes(actor.permission));
    let resyncRequired=false;

    for (const raw of packet.ops) {
      const kind=String(raw?.kind||'');
      if (kind==='present_page' && canManage) {
        const pageId=safeId(raw.pageId),allowed=Array.isArray(actor.allowedPages)?actor.allowedPages:[actor.pageId];
        if(!pageId||!allowed.includes(pageId)||await this.ctx.storage.get('deletedpage:'+pageId))continue;
        this.broadcast({type:'page_focus',pageId,by:actor.userId});
        continue;
      }
      if (kind==='vote_toggle') {
        if(!canVote)continue;
        const pageId=safeId(raw.pageId),objectId=safeId(raw.objectId);
        if(!pageId||!objectId||pageId!==actor.pageId)continue;
        const objectKey='obj:'+pageId+':'+objectId;
        const existing=await this.ctx.storage.get(objectKey);
        if(!existing||!['note','text'].includes(existing.type))continue;
        const voteKey='vote:'+pageId+':'+objectId+':'+actor.userId;
        const voted=Boolean(await this.ctx.storage.get(voteKey));
        let count=Math.max(0,Number(existing.voteCount)||0);
        if(voted){await this.ctx.storage.delete(voteKey);count=Math.max(0,count-1);}
        else {await this.ctx.storage.put(voteKey,true);count++;}
        existing.voteCount=count;await this.ctx.storage.put(objectKey,existing);
        this.broadcast({type:'vote_state',pageId,objectId,voteCount:count},null,pageId);
        continue;
      }
      if (kind==='timer_start' && canManage) {
        const durationSec=Math.round(clamp(raw.durationSec,60,5940,300));
        const label=String(raw.label||'').trim().slice(0,80);
        const timer={endAt:Date.now()+durationSec*1000,label,startedBy:actor.userId};
        await this.ctx.storage.put('room:timer',timer);
        this.broadcast({type:'timer_state',timer});
        continue;
      }
      if (kind==='timer_stop' && canManage) {
        await this.ctx.storage.delete('room:timer');
        this.broadcast({type:'timer_state',timer:null});
        continue;
      }
      if (kind==='laser' && canManage) {
        const pageId=safeId(raw.pageId);if(!pageId||pageId!==actor.pageId)continue;
        const x=Math.round(clamp(raw.x,0,1600,0)),y=Math.round(clamp(raw.y,0,900,0));
        this.broadcast({type:'laser',pageId,userId:actor.userId,displayName:actor.displayName||'Giáo viên',x,y},ws,pageId);
        continue;
      }
      if (kind==='stroke_cancel') {
        if (!canDraw) continue;
        const pageId=safeId(raw.pageId),objectId=safeId(raw.objectId);
        if(!pageId||!objectId||pageId!==actor.pageId)continue;
        if(Array.isArray(actor.activeStrokes)&&actor.activeStrokes.includes(objectId)){
          actor.activeStrokes=actor.activeStrokes.filter(id=>id!==objectId);
          ws.serializeAttachment(actor);
        }
        this.broadcast({type:'stroke_cancel',pageId,objectId},ws,pageId);
        continue;
      }
      if (kind==='stroke_segment') {
        if (!canDraw) continue;
        const pageId=safeId(raw.pageId); if (!pageId || pageId!==actor.pageId) continue;
        const points=normalizePoints(raw.points).slice(0,120);
        if (!points.length) continue;
        const objectId=safeId(raw.objectId);if(!objectId)continue;
        if(!Array.isArray(actor.activeStrokes))actor.activeStrokes=[];
        if(!actor.activeStrokes.includes(objectId))actor.activeStrokes=actor.activeStrokes.concat(objectId).slice(-12);
        ws.serializeAttachment(actor);
        this.broadcast({type:'stroke_segment',pageId,objectId,actorId:actor.userId,points,
          color:safeColor(raw.color),width:clamp(raw.width,1,24,3)},ws,pageId);
        continue;
      }
      if (kind==='put') {
        const object=normalizeObject(raw.object,actor);
        if (!object || object.pageId!==actor.pageId) continue;
        if(object.type==='image'){if(!canManage){resyncRequired=true;continue;}}
        else if (object.type==='text'||object.type==='note') { if (!canComment) {resyncRequired=true;continue;} }
        else if (!canDraw) {resyncRequired=true;continue;}
        const key='obj:'+object.pageId+':'+object.id;
        const existing=await this.ctx.storage.get(key);
        if (existing && !canManage && existing.creatorId!==actor.userId) {resyncRequired=true;continue;}
        if (existing?.locked && !canManage) {resyncRequired=true;continue;}
        if (existing?.creatorId) {
          object.creatorId=existing.creatorId;
          object.creatorName=String(existing.creatorName||object.creatorName||'Người dùng').slice(0,100);
          object.creatorClass=String(existing.creatorClass||object.creatorClass||'').slice(0,100);
          object.creatorUnit=String(existing.creatorUnit||object.creatorUnit||'').slice(0,180);
          object.creatorRole=String(existing.creatorRole||object.creatorRole||'student').slice(0,30);
        }
        if (!canManage) object.locked=Boolean(existing?.locked);
        if (Number.isFinite(Number(existing?.voteCount))) object.voteCount=Math.max(0,Number(existing.voteCount)||0);
        const countKey='count:'+object.pageId;
        const pointsKey='points:'+object.pageId;
        const newPoints=object.type==='stroke'?object.points.length:0;
        const oldPoints=existing?.type==='stroke'&&Array.isArray(existing.points)?existing.points.length:0;
        let pointCount=Number(await this.ctx.storage.get(pointsKey));
        if(!Number.isFinite(pointCount)){
          pointCount=0;
          const existingRows=await this.ctx.storage.list({prefix:'obj:'+object.pageId+':'});
          for(const value of existingRows.values())if(value?.type==='stroke'&&Array.isArray(value.points))pointCount+=value.points.length;
        }
        if(pointCount-oldPoints+newPoints>40000){resyncRequired=true;continue;}
        if (!existing) {
          let objectCount=Number(await this.ctx.storage.get(countKey));
          if (!Number.isFinite(objectCount)) {
            objectCount=(await this.ctx.storage.list({prefix:'obj:'+object.pageId+':'})).size;
          }
          if (objectCount>=600) {resyncRequired=true;continue;}
          await this.ctx.storage.put(countKey,objectCount+1);
        }
        await this.ctx.storage.put(pointsKey,Math.max(0,pointCount-oldPoints+newPoints));
        await this.ctx.storage.put(key,object);
        if(Array.isArray(actor.activeStrokes)&&actor.activeStrokes.includes(object.id)){
          actor.activeStrokes=actor.activeStrokes.filter(id=>id!==object.id);
          ws.serializeAttachment(actor);
        }
        this.broadcast({type:'put',object},null,object.pageId);
        continue;
      }
      if (kind==='delete') {
        if (!canComment) {resyncRequired=true;continue;}
        const pageId=safeId(raw.pageId), objectId=safeId(raw.objectId);
        if (!pageId||!objectId||pageId!==actor.pageId) continue;
        const key='obj:'+pageId+':'+objectId;
        const existing=await this.ctx.storage.get(key);
        if (!existing) continue;
        if (!canManage && (existing.creatorId!==actor.userId || existing.locked)) {resyncRequired=true;continue;}
        await this.ctx.storage.delete(key);
        const voteRows=await this.ctx.storage.list({prefix:'vote:'+pageId+':'+objectId+':'});
        if(voteRows.size)await this.ctx.storage.delete([...voteRows.keys()]);
        const countKey='count:'+pageId,pointsKey='points:'+pageId;
        const objectCount=Number(await this.ctx.storage.get(countKey));
        if (Number.isFinite(objectCount) && objectCount>0) await this.ctx.storage.put(countKey,objectCount-1);
        if(existing?.type==='stroke'&&Array.isArray(existing.points)){
          const pointCount=Number(await this.ctx.storage.get(pointsKey));
          if(Number.isFinite(pointCount))await this.ctx.storage.put(pointsKey,Math.max(0,pointCount-existing.points.length));
        }
        this.broadcast({type:'delete',pageId,objectId},null,pageId);
        continue;
      }
      if (kind==='clear_page' && canManage) {
        const pageId=safeId(raw.pageId); if (!pageId) continue;
        const rows=await this.ctx.storage.list({prefix:'obj:'+pageId+':'});
        if (rows.size) await this.ctx.storage.delete([...rows.keys()]);
        const voteRows=await this.ctx.storage.list({prefix:'vote:'+pageId+':'});
        if(voteRows.size)await this.ctx.storage.delete([...voteRows.keys()]);
        await this.ctx.storage.put('count:'+pageId,0);
        await this.ctx.storage.put('points:'+pageId,0);
        this.broadcast({type:'clear_page',pageId},null,pageId);
        continue;
      }
      if (kind==='clear_user_objects' && canManage) {
        const targetUserId=safeId(raw.targetUserId),pageId=safeId(raw.pageId);
        if(!targetUserId||!pageId||pageId!==actor.pageId)continue;
        const rows=await this.ctx.storage.list({prefix:'obj:'+pageId+':'});
        const keys=[],objectIds=[];
        for(const [key,value] of rows){
          if(value?.creatorId===targetUserId){keys.push(key);objectIds.push(value.id);}
        }
        let removedPoints=0;
        for(const value of rows.values())if(value?.creatorId===targetUserId&&value?.type==='stroke'&&Array.isArray(value.points))removedPoints+=value.points.length;
        if(keys.length){
          await this.ctx.storage.delete(keys);
          for(const objectId of objectIds){
            const voteRows=await this.ctx.storage.list({prefix:'vote:'+pageId+':'+objectId+':'});
            if(voteRows.size)await this.ctx.storage.delete([...voteRows.keys()]);
          }
        }
        const countKey='count:'+pageId,pointsKey='points:'+pageId;
        const objectCount=Number(await this.ctx.storage.get(countKey));
        if(Number.isFinite(objectCount))await this.ctx.storage.put(countKey,Math.max(0,objectCount-keys.length));
        const pointCount=Number(await this.ctx.storage.get(pointsKey));
        if(Number.isFinite(pointCount))await this.ctx.storage.put(pointsKey,Math.max(0,pointCount-removedPoints));
        this.broadcast({type:'clear_user_objects',pageId,targetUserId,objectIds},null,pageId);
        continue;
      }
      if (kind==='set_user_lock' && canManage) {
        const targetUserId=safeId(raw.targetUserId);
        const blocked=raw.blocked===true;
        if(!targetUserId||targetUserId===actor.userId)continue;
        const targets=this.ctx.getWebSockets().filter(socket=>{
          const state=stateOf(socket);return state.userId===targetUserId&&state.role==='student';
        });
        if(!targets.length)continue;
        if(blocked)await this.ctx.storage.put('userlock:'+targetUserId,true);
        else await this.ctx.storage.delete('userlock:'+targetUserId);
        for(const socket of targets){
          const state=stateOf(socket);state.blocked=blocked;socket.serializeAttachment(state);
          try{socket.send(JSON.stringify({type:'user_lock_state',blocked}))}catch{}
        }
        this.broadcast({type:'presence',participants:this.participants()});
        continue;
      }
      if ((kind==='lock'||kind==='unlock') && canManage) {
        const locked=kind==='lock';
        await this.ctx.storage.put('room:locked',locked);
        this.broadcast({type:'lock_state',locked});
      }
    }
    if(clientOpId){
      durableRecent=durableRecent.concat(clientOpId).slice(-80);
      await this.ctx.storage.put(recentKey,durableRecent);
      try{ws.send(JSON.stringify({type:'op_ack',clientOpId}))}catch{}
    }
    if(resyncRequired){try{ws.send(JSON.stringify({type:'resync_required'}))}catch{}}
  }

  cleanupTransientStrokes(ws) {
    const state=stateOf(ws),ids=Array.isArray(state.activeStrokes)?state.activeStrokes:[];
    for(const objectId of ids){
      this.broadcast({type:'stroke_cancel',pageId:state.pageId,objectId},ws,state.pageId||'');
    }
  }

  webSocketClose(ws) {
    this.cleanupTransientStrokes(ws);
    try { ws.close(1000,''); } catch {}
    this.broadcast({type:'presence',participants:this.participants()});
  }

  webSocketError(ws) {
    this.cleanupTransientStrokes(ws);
    try { ws.close(1011,'WebSocket error'); } catch {}
  }
}
