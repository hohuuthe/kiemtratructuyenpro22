import {getDatabase} from '../exam/utils';
import {ensureEssayGradingSchema,processStoredEssayGrading} from '../../../src/essay-grading-pipeline.js';
interface Env { ESSAY_RETRY_CRON_SECRET?:string }
const reply=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{
  'Content-Type':'application/json','Cache-Control':'no-store'
}});
function safeEqual(a:string,b:string) {
  const x=new TextEncoder().encode(a), y=new TextEncoder().encode(b);
  let diff=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++) diff|=(x[i]||0)^(y[i]||0);
  return diff===0;
}
/**
 * Conditional batch retry for an external scheduled trigger.
 * Config required: Cloudflare Pages ESSAY_RETRY_CRON_SECRET, and an external
 * scheduler POST to this tenant's hostname with Authorization Bearer <secret>.
 * No secrets or student answers are returned.
 */
export const onRequestPost:PagesFunction<Env>=async(context)=>{
  const key=String(context.env?.ESSAY_RETRY_CRON_SECRET||'');
  const auth=context.request.headers.get('Authorization')||'';
  if(key.length<24) return reply({error:'Chưa cấu hình trình chấm bù định kỳ.'},503);
  if(!auth.startsWith('Bearer ')||!safeEqual(auth.slice(7),key))
    return reply({error:'Unauthorized'},401);
  try {
    const db=getDatabase(context);
    await ensureEssayGradingSchema(db);
    const now=new Date().toISOString();
    // At most two requests per wakeup; each has a strictly bounded provider budget.
    const rows:any=await db.prepare(
      "SELECT id FROM results WHERE grading_status IN ('pending','retry_pending','waiting_key') " +
      "AND (grading_retry_at IS NULL OR grading_retry_at <= ?) " +
      "AND (grading_lease_until IS NULL OR grading_lease_until < ?) " +
      "ORDER BY COALESCE(grading_retry_at,created_at) ASC, id ASC LIMIT 2"
    ).bind(now,now).all();
    const states:any[]=[];
    for(const row of rows?.results||[]){
      try {
        const result=await processStoredEssayGrading(db,String(row.id),{budgetMs:12000});
        states.push({completed:result?.gradingStatus==='completed'});
      }catch(_error){states.push({completed:false});}
    }
    return reply({processed:states.length, completed:states.filter(x=>x.completed).length});
  }catch(error){
    console.error('Scheduled essay grading unavailable');
    return reply({error:'Không thể xử lý đợt chấm bù.'},503);
  }
};
