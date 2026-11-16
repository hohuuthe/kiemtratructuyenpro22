import { verifyJWT, verifyAuthSession, getDatabase, getDynamicSecret } from './utils';
import { ensureExamLivenessSchema, finalizeExamLiveness } from './finalize-service';

interface Env {
  NEON_DATABASE_URL?: string; DATABASE_URL?: string; JWT_SECRET?: string; DB?: any;
}
const headers = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'Content-Type, Authorization',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json','Cache-Control':'no-store'
};
const reply=(status:number,data:any)=>new Response(JSON.stringify(data),{status,headers});
export const onRequestOptions:PagesFunction<Env>=async()=>new Response(null,{status:204,headers});

export const onRequestPost:PagesFunction<Env>=async context=>{
  try {
    const db=getDatabase(context);
    const body:any=await context.request.json();
    const token=String(body?.token||'');
    const action=String(body?.action||'heartbeat');
    if (!['heartbeat','leave'].includes(action)||!token) return reply(400,{error:'Heartbeat không hợp lệ.'});
    const secret=await getDynamicSecret(db,context.env.JWT_SECRET);
    const signed:any=await verifyJWT(token,secret);
    if (!signed||signed.purpose!=='exam_active'||!signed.gradingSessionId) {
      return reply(403,{error:'Phiên thi không còn hợp lệ.'});
    }
    const sessionId=String(signed.gradingSessionId);
    const examId=String(signed.examConfig?.id||'');
    const signedUser=String(signed.studentUserId||'');
    const participant=String(signed.contestParticipantId||'');
    if (!examId || (signedUser&&participant)) return reply(403,{error:'Sai danh tính phiên thi.'});
    if (signedUser) {
      const auth=context.request.headers.get('authorization')||'';
      if (!auth.startsWith('Bearer ')) return reply(401,{error:'Thiếu xác thực tài khoản.'});
      const live:any=await verifyAuthSession(auth.slice(7),secret,db);
      if (String(live?.user_id||live?.id||'')!==signedUser) return reply(403,{error:'Phiên thi không thuộc tài khoản.'});
    }
    const snapshot:any=await db.prepare(
      'SELECT exam_id,started_at FROM _exam_grade_sessions WHERE session_id=?'
    ).bind(sessionId).first();
    if (!snapshot?.started_at||String(snapshot.exam_id)!==examId) {
      return reply(409,{code:'EXAM_ALREADY_FINALIZED',error:'Bài thi đã kết thúc hoặc không còn hoạt động.'});
    }
    if (signedUser||participant) {
      const active:any=await db.prepare(
        'SELECT session_id FROM _exam_active_attempts WHERE session_id=? AND exam_id=? AND user_id=?'
      ).bind(sessionId,examId,signedUser||('contest:'+participant)).first();
      if (!active) return reply(409,{code:'EXAM_ATTEMPT_NOT_ACTIVE',error:'Bài thi đã kết thúc.'});
    }
    await ensureExamLivenessSchema(db);
    const now=new Date().toISOString();
    const changed:any=action==='leave'
      ? await db.prepare(`
          UPDATE _exam_attempt_liveness
          SET leave_requested_at=COALESCE(leave_requested_at,?)
          WHERE session_id=? AND exam_id=? AND finalized_at IS NULL
        `).bind(now,sessionId,examId).run()
      : await db.prepare(`
          UPDATE _exam_attempt_liveness
          SET last_seen_at=?
          WHERE session_id=? AND exam_id=? AND finalized_at IS NULL
            AND leave_requested_at IS NULL AND finalizing_at IS NULL
        `).bind(now,sessionId,examId).run();
    if (Number(changed?.meta?.changes||0)!==1) {
      return reply(409,{code:'EXAM_LIVENESS_LOCKED',error:'Bài thi đang được kết thúc hoặc đã hoàn tất.'});
    }
    if (action==='leave' && typeof context.waitUntil==='function') {
      context.waitUntil(finalizeExamLiveness(context,sessionId));
    }
    return reply(200,{accepted:true,action,serverNow:now});
  } catch(error:any) {
    console.error('Exam liveness event failed:',error);
    return reply(503,{code:'EXAM_HEARTBEAT_UNAVAILABLE',error:'Máy chủ chưa xác nhận được trạng thái bài thi.'});
  }
};
