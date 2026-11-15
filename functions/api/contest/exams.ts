import { getDatabase } from '../exam/utils';
import { respond, CONTEST_EXAM_MODE } from './register';

export const onRequestGet: PagesFunction = async (context: any) => {
  try {
    const db = getDatabase(context);
    if (!db) return respond({error:'Cơ sở dữ liệu chưa sẵn sàng.'},503);
    const {results} = await db.prepare(`
      SELECT id,name,creator_id,time_limit,count_41,count_tf4,count_sq,count_tl,
             max_attempts,tg_bd,tg_kt,access_control
      FROM exam_configs
      WHERE chedodethi = ? AND contest_status = 'published'
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT 200
    `).bind(CONTEST_EXAM_MODE).all();
    const data = (results || []).map((row:any)=>{
      let acl:any = {};
      try {acl = typeof row.access_control==='string'?JSON.parse(row.access_control):row.access_control||{};} catch {}
      return {
        id:row.id,name:row.name,creator_id:row.creator_id,time_limit:row.time_limit,
        so_cau:Number(row.count_41||0)+Number(row.count_tf4||0)+Number(row.count_sq||0)+Number(row.count_tl||0),
        max_attempts:row.max_attempts,
        bat_dau:row.tg_bd|| (acl.enabled ? acl.startTime : null),
        ket_thuc:row.tg_kt|| (acl.enabled ? acl.endTime : null)
      };
    });
    return respond({data,error:null});
  } catch {
    return respond({data:null,error:'Không thể tải danh sách cuộc thi. Vui lòng thử lại.'},503);
  }
};
