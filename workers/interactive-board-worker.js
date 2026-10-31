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
    ? [clamp(p[0],-20000,20000,0),clamp(p[1],-20000,20000,0)]
    : null).filter(Boolean);
}
function normalizeObject(input, actorId) {
  if (!input || typeof input !== 'object') return null;
  const id=safeId(input.id), pageId=safeId(input.pageId), type=String(input.type||'');
  if (!id || !pageId || !['stroke','text','note','rect','ellipse','line','arrow'].includes(type)) return null;
  const base={id,pageId,type,creatorId:actorId,updatedAt:Date.now()};
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
    if (request.method==='POST' && url.pathname==='/internal/board-reset') {
      const secret=String(env.BOARD_REALTIME_SECRET || env.JWT_SECRET || '');
      if (!secret || !secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret)) {
        return new Response('Unauthorized',{status:401});
      }
      let body;try{body=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
      const tenant=String(body?.tenant||''),boardId=safeId(body?.boardId);
      if(!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)||!boardId)return new Response('Invalid board',{status:400});
      const roomName=tenant+':'+boardId;
      const stub=env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(roomName));
      return stub.fetch(new Request('https://board.internal/reset',{method:'POST',headers:{'X-Board-Internal-Secret':secret}}));
    }
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', {status:426});
    }
    const token = url.searchParams.get('token') || '';
    const claims = await verifyJwt(token, String(env.BOARD_REALTIME_SECRET || env.JWT_SECRET || ''));
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
    if(request.method==='POST'&&url.pathname==='/reset'){
      const secret=String(this.env.BOARD_REALTIME_SECRET || this.env.JWT_SECRET || '');
      if(!secret||!secureEqualString(request.headers.get('X-Board-Internal-Secret'),secret))return new Response('Unauthorized',{status:401});
      for(const socket of this.ctx.getWebSockets()){try{socket.send(JSON.stringify({type:'board_deleted'}));socket.close(4004,'Board deleted')}catch{}}
      await this.ctx.storage.deleteAll();
      return new Response('OK');
    }
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('WebSocket required',{status:426});
    const token=url.searchParams.get('token')||'';
    const claims=await verifyJwt(token,String(this.env.BOARD_REALTIME_SECRET || this.env.JWT_SECRET || ''));
    if (!claims || claims.tokenType!=='board_join') return new Response('Unauthorized',{status:401});
    const boardId=safeId(claims.boardId), userId=safeId(claims.userId);
    const signedPageId=safeId(claims.pageId || '');
    const requestedPageId=safeId(url.searchParams.get('pageId') || signedPageId);
    if (!boardId || !userId || !signedPageId || requestedPageId!==signedPageId) {
      return new Response('Invalid room parameters',{status:403});
    }
    const pageId=signedPageId;
    const sockets=this.ctx.getWebSockets();
    const max=clamp(claims.maxParticipants,1,120,60);
    const sameUser=sockets.filter(ws=>stateOf(ws).userId===userId);
    if (sameUser.length>=3) return new Response('Too many connections for this account',{status:429});
    const distinctUsers=new Set(sockets.map(ws=>stateOf(ws).userId).filter(Boolean));
    if (!distinctUsers.has(userId) && distinctUsers.size>=max) return new Response('Room full',{status:429});

    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    const attachment={
      boardId,userId,pageId,
      displayName:String(claims.displayName||'Người dùng').slice(0,100),
      role:String(claims.role||'student'),
      permission:String(claims.permission||'view'),
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
    const snapshot=[...objects.values()].slice(0,1000);
    server.send(JSON.stringify({type:'snapshot',pageId,locked,objects:snapshot,participants:this.participants()}));
    this.broadcast({type:'presence',participants:this.participants()},server);
    return new Response(null,{status:101,webSocket:client});
  }

  participants() {
    const seen=new Map();
    for (const ws of this.ctx.getWebSockets()) {
      const s=stateOf(ws);
      if (!s.userId) continue;
      if (!seen.has(s.userId)) seen.set(s.userId,{userId:s.userId,displayName:s.displayName||'Người dùng',role:s.role||'student'});
    }
    return [...seen.values()].slice(0,120);
  }

  broadcast(payload, except=null, pageId='') {
    const text=JSON.stringify(payload);
    const sockets=pageId ? this.ctx.getWebSockets(pageId) : this.ctx.getWebSockets();
    for (const socket of sockets) {
      if (socket===except || socket.readyState!==WebSocket.OPEN) continue;
      try { socket.send(text); } catch {}
    }
  }

  async webSocketMessage(ws,message) {
    const actor=stateOf(ws);
    if (!actor.userId || typeof message!=='string' || message.length>65536) return;
    let packet; try { packet=JSON.parse(message); } catch { return; }
    if (!packet || packet.type!=='op_batch' || !Array.isArray(packet.ops) || packet.ops.length>80) return;
    const roomLocked=Boolean(await this.ctx.storage.get('room:locked'));
    const canManage=actor.permission==='manage' || actor.role==='teacher' || actor.role==='admin';
    const canDraw=canManage || (!roomLocked && actor.permission==='draw');
    const canComment=canManage || (!roomLocked && ['draw','comment'].includes(actor.permission));

    for (const raw of packet.ops) {
      const kind=String(raw?.kind||'');
      if (kind==='stroke_segment') {
        if (!canDraw) continue;
        const pageId=safeId(raw.pageId); if (!pageId || pageId!==actor.pageId) continue;
        const points=normalizePoints(raw.points).slice(0,120);
        if (!points.length) continue;
        this.broadcast({type:'stroke_segment',pageId,objectId:safeId(raw.objectId),actorId:actor.userId,points,
          color:safeColor(raw.color),width:clamp(raw.width,1,24,3)},ws,pageId);
        continue;
      }
      if (kind==='put') {
        const object=normalizeObject(raw.object,actor.userId);
        if (!object || object.pageId!==actor.pageId) continue;
        if (object.type==='text'||object.type==='note') { if (!canComment) continue; }
        else if (!canDraw) continue;
        const key='obj:'+object.pageId+':'+object.id;
        const existing=await this.ctx.storage.get(key);
        if (existing && !canManage && existing.creatorId!==actor.userId) continue;
        if (!existing) {
          const countKey='count:'+object.pageId;
          let objectCount=Number(await this.ctx.storage.get(countKey));
          if (!Number.isFinite(objectCount)) {
            objectCount=(await this.ctx.storage.list({prefix:'obj:'+object.pageId+':'})).size;
          }
          if (objectCount>=1000) continue;
          await this.ctx.storage.put(countKey,objectCount+1);
        }
        await this.ctx.storage.put(key,object);
        this.broadcast({type:'put',object},null,object.pageId);
        continue;
      }
      if (kind==='delete') {
        if (!canComment) continue;
        const pageId=safeId(raw.pageId), objectId=safeId(raw.objectId);
        if (!pageId||!objectId||pageId!==actor.pageId) continue;
        const key='obj:'+pageId+':'+objectId;
        const existing=await this.ctx.storage.get(key);
        if (!existing || (!canManage && existing.creatorId!==actor.userId)) continue;
        await this.ctx.storage.delete(key);
        const countKey='count:'+pageId;
        const objectCount=Number(await this.ctx.storage.get(countKey));
        if (Number.isFinite(objectCount) && objectCount>0) await this.ctx.storage.put(countKey,objectCount-1);
        this.broadcast({type:'delete',pageId,objectId},null,pageId);
        continue;
      }
      if (kind==='clear_page' && canManage) {
        const pageId=safeId(raw.pageId); if (!pageId) continue;
        const rows=await this.ctx.storage.list({prefix:'obj:'+pageId+':'});
        if (rows.size) await this.ctx.storage.delete([...rows.keys()]);
        await this.ctx.storage.put('count:'+pageId,0);
        this.broadcast({type:'clear_page',pageId},null,pageId);
        continue;
      }
      if ((kind==='lock'||kind==='unlock') && canManage) {
        const locked=kind==='lock';
        await this.ctx.storage.put('room:locked',locked);
        this.broadcast({type:'lock_state',locked});
      }
    }
  }

  webSocketClose(ws) {
    try { ws.close(1000,''); } catch {}
    this.broadcast({type:'presence',participants:this.participants()});
  }

  webSocketError(ws) {
    try { ws.close(1011,'WebSocket error'); } catch {}
  }
}
