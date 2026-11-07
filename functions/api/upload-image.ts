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

    // Accept either a live staff auth token or an ACTIVE exam token.
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Access denied. Bạn chưa đăng nhập hoặc thiếu token xác thực." }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }
    const token = authHeader.substring(7).trim();
    const secret = await getDynamicSecret(db, env.JWT_SECRET);

    const user = await verifyAuthSession(token, secret, db);
    const isStaff = !!user && (
      String(user.role||'').toLowerCase()==='admin' ||
      String(user.role||'').toLowerCase()==='teacher' ||
      String(user.target_audience||'').toLocaleLowerCase('vi')==='giáo viên'
    );

    let examSession: any = null;
    if (!isStaff) {
      const decoded: any = await verifyJWT(token, secret);
      if (decoded?.purpose === EXAM_SESSION_PURPOSE_ACTIVE && decoded?.gradingSessionId) {
        const row: any = await db.prepare(
          'SELECT session_id, started_at, deadline_at, expires_at FROM _exam_grade_sessions WHERE session_id = ? LIMIT 1'
        ).bind(String(decoded.gradingSessionId)).first();
        const now = Date.now();
        const deadline = Date.parse(String(row?.deadline_at||''));
        const expires = Date.parse(String(row?.expires_at||''));
        if (row && row.started_at && Number.isFinite(deadline) && now <= deadline &&
            (!Number.isFinite(expires) || now <= expires)) {
          const signedStudentId = String(decoded.studentUserId || '').trim();
          if (signedStudentId) {
            const accountHeader = request.headers.get('X-Account-Authorization') || '';
            if (!accountHeader.startsWith('Bearer ')) {
              return new Response(JSON.stringify({
                error: 'Thiếu xác thực tài khoản học sinh cho phiên tải ảnh.'
              }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            }
            const account = await verifyAuthSession(accountHeader.slice(7), secret, db);
            const verifiedStudentId = String(account?.user_id || account?.id || '').trim();
            if (!verifiedStudentId || verifiedStudentId !== signedStudentId) {
              return new Response(JSON.stringify({
                error: 'Tài khoản học sinh không khớp phiên thi.'
              }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
          }
          examSession = decoded;
        }
      }
    }

    if (!isStaff && !examSession) {
      return new Response(JSON.stringify({ error: "Access denied. Bạn không có quyền tải ảnh lên hệ thống." }), {
        status: 403, headers: { 'Content-Type': 'application/json' }
      });
    }

    const body: any = await request.json();
    const { base64 } = body;
    const wordImportContentAddressed = body?.wordImportContentAddressed === true;
    if (wordImportContentAddressed && !isStaff) {
      return new Response(JSON.stringify({error:'Chỉ giáo viên hoặc quản trị viên được tải ảnh nhập Word'}), {status:403,headers:{'Content-Type':'application/json'}});
    }
    const maxBase64Length = wordImportContentAddressed ? 11_200_000 : 8_400_000;
    if (typeof base64 !== 'string' || !base64 || base64.length > maxBase64Length) {
      return new Response(JSON.stringify({error:'Dữ liệu ảnh không hợp lệ hoặc vượt giới hạn'}), {status:413,headers:{'Content-Type':'application/json'}});
    }
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(base64)) {
      return new Response(JSON.stringify({error:'Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP.'}), {status:415,headers:{'Content-Type':'application/json'}});
    }

    let r2AccessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    let r2BucketName = env.CLOUDFLARE_R2_BUCKET_NAME;
    let r2AccountId = env.CLOUDFLARE_R2_ACCOUNT_ID;
    let r2PublicUrl = env.CLOUDFLARE_R2_PUBLIC_URL;

    const isR2Configured = r2AccessKeyId && r2SecretAccessKey && r2BucketName && r2AccountId;

    if (!isR2Configured) {
      // Exam uploads must not silently fall back to Base64: large inline images can
      // make the deadline-safe autosave exceed its payload limit.
      if (examSession) {
        return new Response(JSON.stringify({
          error: "Kho ảnh R2 chưa sẵn sàng; chưa thể nhận ảnh bài tự luận an toàn."
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        url: base64,
        storage: "database_base64_compressed",
        message: "Đang sử dụng fallback Base64 cho dữ liệu quản trị."
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Parse the Base64 details
    const matches = base64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    let mimeType = "image/jpeg";
    let base64Data = base64;

    if (matches && matches.length === 3) {
      mimeType = matches[1];
      base64Data = matches[2];
    }

    // Decode base64 to Uint8Array instead of Buffer for Cloudflare Workers compatibility
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const extension = mimeType.split("/")[1] || "jpg";
    const filename = `image-${Math.random().toString(36).substring(2)}-${Date.now()}.${extension}`;
    const objectKey = wordImportContentAddressed
      ? await wordImportImageObjectKey(bytes,String(user?.id || ''),mimeType)
      : examSession
        ? `exam-submissions/${String(examSession.gradingSessionId)}/${filename}`
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
