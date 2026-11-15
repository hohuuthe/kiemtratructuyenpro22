import { getDatabase, getDynamicSecret, signJWT, verifyJWT } from '../exam/utils';
import { consumeSecurityAttempt } from '../../../src/security-rate-limit';
import { evaluateExamAccessWindow } from '../../../src/exam-time-authority.js';

export const CONTEST_MODE = 'contest';
export const CONTEST_EXAM_MODE = 'Cuộc thi trực tuyến';
export const CONTEST_TICKET_PURPOSE = 'contest-registration-v1';
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Host, X-Tenant-Slug'
};

export const respond = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {status, headers});

export async function isContestEnabled(db: any): Promise<boolean> {
  const row: any = await db.prepare(
    'SELECT application_mode FROM app_settings WHERE id = 1'
  ).first();
  return row?.application_mode === CONTEST_MODE;
}

export async function publicContestExam(db: any, id: string): Promise<any | null> {
  if (!id) return null;
  return db.prepare(`
    SELECT id, name, creator_id, chedodethi, contest_status, time_limit,
           count_41, count_tf4, count_sq, count_tl, max_attempts,
           tg_bd, tg_kt, access_control, updated_at
    FROM exam_configs WHERE id = ? AND chedodethi = ?
      AND contest_status = 'published' LIMIT 1
  `).bind(id, CONTEST_EXAM_MODE).first();
}

// Keep the encrypted participant registry stable across JWT secret rotation.
async function getParticipantDataSecret(db: any): Promise<string> {
  await db.prepare('CREATE TABLE IF NOT EXISTS _internal_secrets (key TEXT PRIMARY KEY, value TEXT)').run();
  const newValue = crypto.randomUUID() + ':' + crypto.randomUUID();
  await db.prepare('INSERT INTO _internal_secrets (key,value) VALUES (?,?) ON CONFLICT (key) DO NOTHING')
    .bind('contest_identity_key_v1',newValue).run();
  const row: any = await db.prepare('SELECT value FROM _internal_secrets WHERE key = ?')
    .bind('contest_identity_key_v1').first();
  if (typeof row?.value !== 'string' || row.value.length < 40) {
    throw new Error('CONTEST_IDENTITY_KEY_UNAVAILABLE');
  }
  return row.value;
}
const encoder = new TextEncoder();
function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
async function hmac(secret: string, plain: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const result = await crypto.subtle.sign('HMAC',key,encoder.encode(plain));
  return base64url(new Uint8Array(result));
}
async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode('contest-private-data:v1:'+secret));
  return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
}
async function encryptPrivate(secret: string, value: string): Promise<string | null> {
  if (!value) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret),encoder.encode(value));
  return 'v1.' + base64url(iv) + '.' + base64url(new Uint8Array(ciphertext));
}
function validate(body: any) {
  const name = String(body?.ho_ten || '').normalize('NFKC').trim().replace(/\s+/g,' ');
  const unit = String(body?.don_vi || '').normalize('NFKC').trim().replace(/\s+/g,' ');
  const address = String(body?.dia_chi || '').normalize('NFKC').trim();
  const phone = String(body?.so_dien_thoai || '').replace(/[\s.()-]/g,'');
  const citizen = String(body?.so_cccd || '').trim();
  if (!name || name.length > 120 || !unit || unit.length > 180 ||
      address.length > 300 || !/^(?:\+84|0)[0-9]{9,10}$/.test(phone) ||
      (citizen && !/^[0-9]{12}$/.test(citizen))) {
    throw new Error('Thông tin dự thi không hợp lệ. Kiểm tra họ tên, đơn vị và số điện thoại.');
  }
  if (body?.dong_y !== true) throw new Error('Bạn cần đồng ý với thông báo xử lý dữ liệu trước khi tham gia.');
  const examId = String(body?.ma_de_thi || '').trim();
  if (!examId || examId.length > 128) throw new Error('Vui lòng chọn cuộc thi hợp lệ.');
  return {name,unit,address,phone,citizen,examId};
}

export async function verifyContestTicket(db: any, secret: string, token: string, examId: string) {
  if (!token || token.length > 5000) return null;
  const claims: any = await verifyJWT(token,secret).catch(()=>null);
  if (!claims || claims.purpose !== CONTEST_TICKET_PURPOSE ||
      claims.examId !== examId || !claims.participantId ||
      claims.exp > Math.floor(Date.now()/1000) + 7200) return null;
  const participant: any = await db.prepare(
    'SELECT ma_nguoi_du_thi, ho_ten, don_vi FROM contest_participants WHERE ma_nguoi_du_thi = ?'
  ).bind(String(claims.participantId)).first();
  if (!participant) return null;
  return {participantId: String(participant.ma_nguoi_du_thi), name: String(participant.ho_ten), unit: String(participant.don_vi)};
}

export const onRequestOptions: PagesFunction = async () => respond({error:'Method not allowed'},405);
export const onRequestPost: PagesFunction = async (context: any) => {
  const db = getDatabase(context);
  if (!db) return respond({error:'Không thể kết nối cơ sở dữ liệu.'},503);
  try {
    if (!(await isContestEnabled(db))) return respond({error:'Cổng cuộc thi chưa được kích hoạt.'},403);
    const rate = await consumeSecurityAttempt(db,context.request,'contest-registration','public',{
      maxAttempts: 10,windowMs: 10*60*1000,blockMs: 15*60*1000
    });
    if (!rate.allowed) return respond({error:'Có quá nhiều lượt đăng ký. Vui lòng thử lại sau.'},429);
    const body = await context.request.json();
    const v = validate(body);
    const exam = await publicContestExam(db,v.examId);
    if (!exam) return respond({error:'Cuộc thi không được công bố hoặc đã bị thu hồi.'},403);
    const access = evaluateExamAccessWindow(exam,Date.now());
    if (!access.allowed) return respond({error:access.code === 'EXAM_NOT_STARTED' ? 'Cuộc thi chưa đến thời gian bắt đầu.' : access.code === 'EXAM_WINDOW_CLOSED' ? 'Cuộc thi đã hết thời gian tham gia.' : 'Khung thời gian cuộc thi chưa hợp lệ.'},403);
    const secret = await getDynamicSecret(db,context.env.JWT_SECRET);
    const participantSecret = await getParticipantDataSecret(db);
    // Phone-based deduplication is a best-effort identifier, NOT proof of phone ownership.
    // Official one-person competitions require a verified OTP provider in a later release.
    const identity = await hmac(participantSecret,'contest-phone:v1:'+v.phone);
    const candidateId = 'ct_' + (await hmac(participantSecret,'contest-candidate:v1:'+identity)).slice(0,40);
    const previous: any = await db.prepare(
      'SELECT ma_nguoi_du_thi, ho_ten, don_vi FROM contest_participants WHERE ma_dinh_danh_bam = ?'
    ).bind(identity).first();
    if (previous && (
      String(previous.ho_ten).toLocaleLowerCase('vi-VN') !== v.name.toLocaleLowerCase('vi-VN') ||
      String(previous.don_vi).toLocaleLowerCase('vi-VN') !== v.unit.toLocaleLowerCase('vi-VN')
    )) return respond({error:'Số điện thoại này đã được dùng với hồ sơ dự thi khác. Liên hệ ban tổ chức để xác minh.'},409);
    if (!previous) {
      await db.prepare(`
        INSERT INTO contest_participants
          (ma_nguoi_du_thi,ho_ten,don_vi,dia_chi_ma_hoa,so_dien_thoai_ma_hoa,
           so_cccd_ma_hoa,ma_dinh_danh_bam,thoi_diem_dong_y)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT (ma_dinh_danh_bam) DO NOTHING
      `).bind(candidateId,v.name,v.unit,await encryptPrivate(participantSecret,v.address),
        await encryptPrivate(participantSecret,v.phone),await encryptPrivate(participantSecret,v.citizen),
        identity,new Date().toISOString()).run();
      const stored: any = await db.prepare(
        'SELECT ho_ten,don_vi FROM contest_participants WHERE ma_nguoi_du_thi = ?'
      ).bind(candidateId).first();
      if (!stored || String(stored.ho_ten) !== v.name || String(stored.don_vi) !== v.unit)
        return respond({error:'Không xác minh được hồ sơ dự thi, vui lòng liên hệ ban tổ chức.'},409);
    }
    const maxAttempts = Math.max(0,Number(exam.max_attempts)||0);
    if (maxAttempts) {
      const done: any = await db.prepare(
        'SELECT COUNT(*) AS count FROM results WHERE exam_id = ? AND ma_nguoi_du_thi = ?'
      ).bind(exam.id,candidateId).first();
      if ((Number(done?.count) || 0) >= maxAttempts) {
        return respond({code:'EXAM_ATTEMPT_LIMIT_REACHED',error:'Bạn đã hết số lượt tham gia cuộc thi này.'},403);
      }
    }
    const now = Math.floor(Date.now()/1000);
    const ticket = await signJWT({
      purpose:CONTEST_TICKET_PURPOSE,examId:exam.id,participantId:candidateId,iat:now,exp:now+2*3600
    },secret);
    return respond({data:{ticket,ma_de_thi:exam.id,ten_de_thi:exam.name,ma_nguoi_du_thi:candidateId}});
  } catch(error:any) {
    const known = error?.message?.startsWith('Thông tin') || error?.message?.startsWith('Bạn cần') ||
      error?.message?.startsWith('Vui lòng');
    console.error('[contest/register]',known?'invalid input':'server unavailable');
    return respond({error:known?error.message:'Không thể đăng ký an toàn. Vui lòng thử lại.'},known?400:503);
  }
};
