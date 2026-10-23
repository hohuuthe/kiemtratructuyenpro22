import { verifyAuthSession, getDynamicSecret, hashPasswordPBKDF2, getDatabase } from '../exam/utils';

export async function onRequestPut(context: any) {
    const { request, env, params } = context;
    const db = getDatabase(context);
    const accountId = params.id;
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Content-Type': 'application/json'
    };

    const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const token = authHeader.substring(7);
    const user = await verifyAuthSession(token, SECRET, db);
    if (!user || user.role !== 'admin') {
        return new Response(JSON.stringify({ error: "Chỉ Admin mới được sửa tài khoản" }), { status: 403, headers: corsHeaders });
    }

    try {
        const body = await request.json();
        const { user_id, username, password, role, is_active, expiry_date } = body;

        if (username) {
            const { results } = await db.prepare("SELECT id FROM accounts WHERE username = ? AND id != ?").bind(username.trim(), accountId).all();
            if (results && results.length > 0) {
                return new Response(JSON.stringify({ error: "Tên đăng nhập đã tồn tại!" }), { status: 400, headers: corsHeaders });
            }
        }

        const updates = [];
        const sqlParams = [];
        
        if (user_id !== undefined) { updates.push("user_id = ?"); sqlParams.push(user_id || null); }
        if (username !== undefined) { updates.push("username = ?"); sqlParams.push(username.trim()); }
        if (role !== undefined) { updates.push("role = ?"); sqlParams.push(role); }
        if (is_active !== undefined) { 
            const activeVal = (is_active !== false && is_active !== 0 && is_active !== 'false') ? 1 : 0;
            updates.push("is_active = ?"); 
            sqlParams.push(activeVal); 
        }
        if (expiry_date !== undefined) { updates.push("expiry_date = ?"); sqlParams.push(expiry_date || null); }

        if (password) {
            const hashedPassword = await hashPasswordPBKDF2(password);
            updates.push("password = ?");
            sqlParams.push(hashedPassword);
        }

        if (updates.length > 0) {
            sqlParams.push(accountId);
            const sql = `UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`;
            await db.prepare(sql).bind(...sqlParams).run();
        }

        return new Response(JSON.stringify({ data: { id: accountId }, error: null }), { status: 200, headers: corsHeaders });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message || "Lỗi DB" }), { status: 500, headers: corsHeaders });
    }
}

export async function onRequestDelete(context: any) {
    const { request, env, params } = context;
    const db = getDatabase(context);
    const accountId = params.id;
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Content-Type': 'application/json'
    };

    const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const token = authHeader.substring(7);
    const user = await verifyAuthSession(token, SECRET, db);
    if (!user || user.role !== 'admin') {
        return new Response(JSON.stringify({ error: "Chỉ Admin mới được xóa tài khoản" }), { status: 403, headers: corsHeaders });
    }

    if (accountId === user.id) {
        return new Response(JSON.stringify({ error: "Không thể tự xóa tài khoản của chính mình!" }), { status: 400, headers: corsHeaders });
    }

    try {
        await db.prepare("DELETE FROM accounts WHERE id = ?").bind(accountId).run();
        return new Response(JSON.stringify({ data: { success: true }, error: null }), { status: 200, headers: corsHeaders });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message || "Lỗi DB" }), { status: 500, headers: corsHeaders });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        }
    });
}
