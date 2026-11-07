import { consumeSecurityAttempt, clearSecurityAttempts } from '../../../src/security-rate-limit';
import { verifyPasswordPBKDF2, hashPasswordPBKDF2, getDatabase } from '../exam/utils';

export async function onRequestPost(context: any) {
    const { request, env } = context;
    const db = getDatabase(context);
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    try {
        const body = await request.json();
        const { username, oldPassword, newPassword } = body;
        
        if (!username || !oldPassword || !newPassword) {
            return new Response(JSON.stringify({ error: "Vui lòng cung cấp đầy đủ thông tin!" }), { status: 400, headers: corsHeaders });
        }

        if (newPassword.length < 6) {
            return new Response(JSON.stringify({ error: "Mật khẩu mới phải có ít nhất 6 ký tự!" }), { status: 400, headers: corsHeaders });
        }

        const limit = await consumeSecurityAttempt(db, request, 'change-password', username, {
            maxAttempts: 8, windowMs: 5 * 60_000, blockMs: 10 * 60_000
        });
        if (!limit.allowed) {
            return new Response(JSON.stringify({
                error: "Đã có quá nhiều lần thử đổi mật khẩu. Vui lòng thử lại sau.",
                code: "AUTH_RATE_LIMITED",
                retry_after_seconds: limit.retryAfterSeconds
            }), { status: 429, headers: { ...corsHeaders, 'Retry-After': String(limit.retryAfterSeconds) } });
        }

        const { results } = await db.prepare("SELECT * FROM accounts WHERE username = ?").bind(username).all();
        if (!results || results.length === 0) {
            return new Response(JSON.stringify({ error: "Tên đăng nhập hoặc mật khẩu cũ không đúng!" }), { status: 400, headers: corsHeaders });
        }

        const account = results[0];
        const isValid = await verifyPasswordPBKDF2(oldPassword, account.password);
        if (!isValid) {
            return new Response(JSON.stringify({ error: "Tên đăng nhập hoặc mật khẩu cũ không đúng!" }), { status: 400, headers: corsHeaders });
        }
        await clearSecurityAttempts(db, 'change-password', limit.keyHash);

        const hashedNewPassword = await hashPasswordPBKDF2(newPassword);
        await db.prepare("UPDATE accounts SET password = ? WHERE id = ?").bind(hashedNewPassword, account.id).run();

        return new Response(JSON.stringify({ data: { success: true }, error: null }), { status: 200, headers: corsHeaders });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message || "Lỗi máy chủ khi đổi mật khẩu" }), { status: 500, headers: corsHeaders });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
        }
    });
}
