import { verifyAuthSession, getDynamicSecret, getDatabase, checkIsTeacherOrAdmin, checkIsAdmin } from '../exam/utils';
import {liveExamVisibility} from '../../../src/exam-grading-safety.js';
import {ensureEssayGradingSchema,processStoredEssayGrading,publicEssayGradingResult} from '../../../src/essay-grading-pipeline.js';

interface Env { JWT_SECRET?:string }
const headers = {'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization'};
const respond=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers});

/** Authenticated recovery after a provider/network outage.
 * Access is scoped by the live account; throttling is persisted in DB.
 */
export const onRequestPost: PagesFunction<Env> = async context => {
  try {
    const db=getDatabase(context);
    const auth=context.request.headers.get('Authorization')||'';
    if (!auth.startsWith('Bearer ')) return respond({error:'Đăng nhập để chấm lại.'},401);
    const user=await verifyAuthSession(auth.slice(7),
      await getDynamicSecret(db,context.env.JWT_SECRET),db);
    if (!user) return respond({error:'Phiên đăng nhập không hợp lệ.'},401);
    const payload:any=await context.request.json();
    const resultId=String(payload?.resultId||'').trim();
    if(!/^[A-Za-z0-9-]{10,100}$/.test(resultId)) return respond({error:'Mã bài không hợp lệ.'},400);
    await ensureEssayGradingSchema(db);
    const row:any=await db.prepare(
      'SELECT r.id,r.user_id,r.exam_id,r.grading_status,r.grading_retry_at,'+
      'e.creator_id,e.show_score FROM results r LEFT JOIN exam_configs e ON e.id=r.exam_id WHERE r.id = ?'
    ).bind(resultId).first();
    if(!row) return respond({error:'Không tìm thấy bài làm.'},404);
    const admin=checkIsAdmin(user);
    const teacher=checkIsTeacherOrAdmin(user);
    const own=!!row.user_id && [user.id,user.user_id].some(
      value=>value && String(value)===String(row.user_id));
    const creator=teacher && !!row.creator_id && [user.id,user.user_id].some(
      value=>value && String(value)===String(row.creator_id));
    if(!admin&&!creator&&!own) return respond({error:'Không được phép xử lý bài làm này.'},403);
    const canSeeScore=(admin||creator||liveExamVisibility({show_score:row.show_score}).showScore);
    const publicSummary=(value:any)=>value?{...value,score:canSeeScore?value.score:null}:value;
    const force=!!(admin||creator); // Teacher can request early retry after updating keys.
    if(!['pending','retry_pending','waiting_key','processing'].includes(row.grading_status)){
      return respond({data:publicSummary(publicEssayGradingResult(row)),error:null});
    }
    // Runtime is bounded. A busy lease simply returns current state.
    const summary=await processStoredEssayGrading(db,resultId,{budgetMs:16000,force});
    return respond({data:publicSummary(summary||publicEssayGradingResult(row)),error:null});
  }catch(error){
    console.error('Essay retry failed');
    return respond({error:'Chưa thể chấm lại lúc này; bài làm đã được lưu an toàn.'},503);
  }
};
export const onRequestOptions:PagesFunction=async()=>new Response(null,{status:204,headers});
