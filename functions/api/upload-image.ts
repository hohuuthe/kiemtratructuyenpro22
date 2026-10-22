import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { verifyJWT, getDynamicSecret, getDatabase } from './exam/utils';

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
    const user = await verifyJWT(token, secret);

    // Cho phép 2 trường hợp hợp lệ:
    // 1. Giáo viên hoặc Admin đã đăng nhập
    // 2. Thí sinh đang trong phiên làm bài thi hợp lệ (token bài thi chứa questionIds và teacherId)
    const isStaff = user && (user.role === 'admin' || user.target_audience === 'Giáo viên');
    const isValidExamSession = user && user.questionIds && user.teacherId;

    if (!isStaff && !isValidExamSession) {
      return new Response(JSON.stringify({ error: "Access denied. Bạn không có quyền tải ảnh lên hệ thống." }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body: any = await request.json();
    const { base64 } = body;
    
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
      return new Response(JSON.stringify({ 
        url: base64, 
        storage: "database_base64_compressed",
        message: "Lưu ý: Đang sử dụng cơ chế fallback (Base64 nén) do chưa cấu hình Cloudflare R2."
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
      Key: `luuhinhnh/${filename}`,
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

    const fileUrl = `${finalPublicUrl}/luuhinhnh/${filename}`;
    
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
