import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { verifyAuthSession, verifyJWT, getDynamicSecret, getDatabase } from './exam/utils';
import { EXAM_SESSION_PURPOSE_ACTIVE } from '../../src/exam-time-authority.js';
import { wordImportImageObjectKey } from '../../src/word-import-image-key.js';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: string;
  CLOUDFLARE_R2_BUCKET_NAME: string;
  CLOUDFLARE_R2_ACCOUNT_ID: string;
  CLOUDFLARE_R2_PUBLIC_URL: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  try {
    const { request, env } = context;

    // BẢO MẬT: Chặn tải ảnh trái phép, chống spam dung lượng kho lưu trữ Cloudflare R2
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Access denied. Bạn chưa đăng nhập hoặc thiếu token xác thực." }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.substring(7);
    const secret = await getDynamicSecret(db, env.JWT_SECRET);

    // The same Authorization header may carry either a normal account token
    // (staff upload) or an ACTIVE exam token (student essay attachment).
    const user = await verifyAuthSession(token, secret, db);
    const isStaff = !!user && (
      String(user.role || '').toLowerCase() === 'admin' ||
      ['teacher','giáo viên'].includes(String(user.role || '').toLocaleLowerCase('vi')) ||
      String(user.target_audience || '').toLocaleLowerCase('vi') === 'giáo viên'
    );

    let examSession: any = null;
    if (!isStaff) {
      const decoded: any = await verifyJWT(token, secret);
      if (decoded?.purpose === EXAM_SESSION_PURPOSE_ACTIVE && decoded?.gradingSessionId) {
        const sessionId = String(decoded.gradingSessionId);
        const session: any = await db.prepare(
          'SELECT session_id, started_at, deadline_at, expires_at FROM _exam_grade_sessions WHERE session_id = ? LIMIT 1'
        ).bind(sessionId).first();
        const now = Date.now();
        const deadline = Date.parse(String(session?.deadline_at || ''));
        const expires = Date.parse(String(session?.expires_at || ''));
        if (session && session.started_at &&
            Number.isFinite(deadline) && now <= deadline &&
            (!Number.isFinite(expires) || now <= expires)) {
          const signedStudentId = String(decoded.studentUserId || '').trim();
          if (signedStudentId) {
            const accountHeader = request.headers.get('X-Account-Authorization') || '';
            if (!accountHeader.startsWith('Bearer ')) {
              return new Response(JSON.stringify({ error: 'Thiếu xác thực tài khoản học sinh cho phiên tải ảnh.' }), {
                status: 401, headers: { 'Content-Type': 'application/json' }
              });
            }
            const account = await verifyAuthSession(accountHeader.slice(7), secret, db);
            const accountId = String(account?.user_id || account?.id || '').trim();
            if (!accountId || accountId !== signedStudentId) {
              return new Response(JSON.stringify({ error: 'Tài khoản học sinh không khớp phiên thi.' }), {
                status: 403, headers: { 'Content-Type': 'application/json' }
              });
            }
          }
          examSession = decoded;
        }
      }
    }

    if (!isStaff && !examSession) {
      return new Response(JSON.stringify({ error: "Access denied. Bạn không có quyền tải ảnh lên hệ thống." }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body: any = await request.json();
    const { base64 } = body;
    const wordImportContentAddressed = body?.wordImportContentAddressed === true;
    if (wordImportContentAddressed && !isStaff) {
      return new Response(JSON.stringify({error:'Chỉ giáo viên hoặc quản trị viên được tải ảnh nhập Word'}), {status:403,headers:{'Content-Type':'application/json'}});
    }
    const maxBase64Length = wordImportContentAddressed ? 11_200_000 : 8_500_000;
    if (typeof base64 !== 'string' || base64.length > maxBase64Length) {
      return new Response(JSON.stringify({error:'Dữ liệu ảnh không hợp lệ hoặc vượt giới hạn'}), {status:413,headers:{'Content-Type':'application/json'}});
    }
    
    if (!base64) {
      return new Response(JSON.stringify({ error: "Thiếu dữ liệu Base64 của ảnh!" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    let r2AccessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    let r2BucketName = env.CLOUDFLARE_R2_BUCKET_NAME;
    let r2AccountId = env.CLOUDFLARE_R2_ACCOUNT_ID;
    let r2PublicUrl = env.CLOUDFLARE_R2_PUBLIC_URL;

    const isR2Configured = r2AccessKeyId && r2SecretAccessKey && r2BucketName && r2AccountId;

    if (!isR2Configured) {
      // Do not silently return a giant Base64 payload during an exam: that can
      // overflow the deadline-safe draft and cost the learner their attachment.
      if (examSession) {
        return new Response(JSON.stringify({
          error: 'Kho ảnh bài thi chưa sẵn sàng. Ảnh chưa được ghi; vui lòng thử lại trước khi nộp bài.'
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ 
        url: base64, 
        storage: "database_base64_compressed",
        message: "Đang sử dụng cơ chế fallback Base64 do chưa cấu hình Cloudflare R2."
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Parse the Base64 details
    const matches = base64.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
    if (!matches || matches.length !== 3) {
      return new Response(JSON.stringify({ error: 'Chỉ chấp nhận ảnh PNG, JPEG hoặc WEBP hợp lệ.' }), {
        status: 415, headers: { 'Content-Type': 'application/json' }
      });
    }
    const mimeType = matches[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : matches[1].toLowerCase();
    const base64Data = matches[2].replace(/[\r\n]/g, '');

    // Decode base64 to Uint8Array instead of Buffer for Cloudflare Workers compatibility
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const extension = mimeType.split("/")[1] || "jpg";
    const filename = `image-${Math.random().toString(36).substring(2)}-${Date.now()}.${extension}`;
    const objectKey = wordImportContentAddressed
      ? await wordImportImageObjectKey(bytes,String(user.id),mimeType)
      : `luuhinhnh/${filename}`;

    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
      forcePathStyle: true,
      // Default fetch handler will be used automatically in Cloudflare Workers
    });

    const command = new PutObjectCommand({
      Bucket: r2BucketName,
      Key: objectKey,
      Body: bytes,
      ContentType: mimeType,
      CacheControl: "public, max-age=31536000, immutable",
    });

    await s3.send(command);

    let finalPublicUrl = r2PublicUrl;
    if (!finalPublicUrl) {
      finalPublicUrl = `https://${r2BucketName}.${r2AccountId}.r2.dev`;
    }
    if (finalPublicUrl.endsWith("/")) {
      finalPublicUrl = finalPublicUrl.slice(0, -1);
    }

    const fileUrl = `${finalPublicUrl}/${objectKey}`;
    
    return new Response(JSON.stringify({ 
      url: fileUrl,
      storage: "cloudflare_r2",
      message: "Tải ảnh lên R2 thành công!"
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error("[Upload Error]:", error);
    return new Response(JSON.stringify({ 
      error: error.message || "Lỗi khi tải ảnh lên máy chủ." 
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
