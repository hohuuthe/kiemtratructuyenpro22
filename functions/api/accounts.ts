import { verifyJWT, getDynamicSecret, hashPasswordPBKDF2, getDatabase, checkIsAdmin, checkIsTeacherOrAdmin } from './exam/utils';

export async function onRequestGet(context: any) {
    const { request, env } = context;
    const db = getDatabase(context);
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
    const authHeader = request.headers.get('Authorization');
    let user = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        user = await verifyJWT(token, SECRET);
    }

    const isAdmin = checkIsAdmin(user);
    const isTeacher = checkIsTeacherOrAdmin(user) && !isAdmin;
    let teacherDonvi = '';
    if (isTeacher) {
        try {
            const dbUser: any = await db.prepare("SELECT donvi FROM users WHERE id = ? OR id = ?").bind(user.user_id || user.id, user.id).first();
            if (dbUser && dbUser.donvi) {
                teacherDonvi = dbUser.donvi.trim();
            }
        } catch (e) {}
        if (!teacherDonvi && user.donvi) {
            teacherDonvi = user.donvi.trim();
        }
    }

    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const pageParam = url.searchParams.get('page');

    let limit = -1; // Mặc định không giới hạn số lượng dòng để tải toàn bộ dữ liệu CSDL
    if (limitParam !== null) {
        if (limitParam === 'all' || limitParam === '0' || limitParam === '-1') {
            limit = -1; // không giới hạn
        } else {
            const parsed = parseInt(limitParam, 10);
            if (!isNaN(parsed) && parsed > 0) limit = parsed;
        }
    }

    let offset = 0;
    if (offsetParam !== null) {
        const parsed = parseInt(offsetParam, 10);
        if (!isNaN(parsed) && parsed >= 0) offset = parsed;
    } else if (pageParam !== null) {
        const page = parseInt(pageParam, 10);
        if (!isNaN(page) && page > 0) offset = (page - 1) * (limit > 0 ? limit : 1000);
    }

    const paginationClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';

    let query = "";
    let queryResult;
    try {
        if (isAdmin) {
            query = `
                SELECT accounts.id, accounts.user_id, accounts.username, accounts.role, accounts.is_active, accounts.expiry_date, accounts.created_at,
                       users.full_name, users.phone_number, users.donvi, users.lop, users.target_audience
                FROM accounts
                LEFT JOIN users ON users.id = COALESCE(accounts.user_id, accounts.id)
                ORDER BY accounts.created_at DESC, accounts.id DESC${paginationClause}
            `;
            queryResult = await db.prepare(query).all();
        } else {
            if (teacherDonvi) {
                query = `
                    SELECT accounts.id, accounts.user_id, accounts.username, accounts.role, accounts.is_active, accounts.expiry_date,
                           users.full_name, users.target_audience, users.donvi, users.lop, users.phone_number
                    FROM accounts
                    LEFT JOIN users ON users.id = COALESCE(accounts.user_id, accounts.id)
                    WHERE users.target_audience = 'Giáo viên' 
                       OR accounts.role = 'teacher' 
                       OR accounts.role = 'giáo viên'
                       OR accounts.role = 'admin' 
                       OR users.target_audience = 'Quản trị viên'
                       OR (TRIM(LOWER(users.donvi)) = TRIM(LOWER(?)) AND LOWER(users.target_audience) = 'học sinh')
                    ORDER BY users.full_name ASC, accounts.username ASC, accounts.id DESC${paginationClause}
                `;
                queryResult = await db.prepare(query).bind(teacherDonvi).all();
            } else {
                query = `
                    SELECT accounts.id, accounts.user_id, accounts.username, accounts.role, accounts.is_active, accounts.expiry_date,
                           users.full_name, users.target_audience, users.donvi, users.lop, users.phone_number
                    FROM accounts
                    LEFT JOIN users ON users.id = COALESCE(accounts.user_id, accounts.id)
                    WHERE users.target_audience = 'Giáo viên' OR accounts.role = 'admin' OR users.target_audience = 'Quản trị viên'
                    ORDER BY users.full_name ASC, accounts.username ASC, accounts.id DESC${paginationClause}
                `;
                queryResult = await db.prepare(query).all();
            }
        }

        const { results } = queryResult || { results: [] };
        const resData = results || [];
        return new Response(JSON.stringify({ 
            data: resData, 
            total: resData.length,
            limit,
            offset,
            has_more: limit > 0 && resData.length === limit,
            error: null 
        }), { status: 200, headers: corsHeaders });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message || "Lỗi DB" }), { status: 500, headers: corsHeaders });
    }
}

export async function onRequestPost(context: any) {
    const { request, env } = context;
    const db = getDatabase(context);
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const token = authHeader.substring(7);
    const user = await verifyJWT(token, SECRET);
    if (!user || user.role !== 'admin') {
        return new Response(JSON.stringify({ error: "Chỉ Admin mới được thêm tài khoản" }), { status: 403, headers: corsHeaders });
    }

    try {
        const body = await request.json();

        // Xử lý tạo tài khoản đồng loạt nếu body có chứa mảng accounts
        if (body && Array.isArray(body.accounts)) {
            const list = body.accounts;
            const created = [];
            const failed = [];
            
            // Tối ưu hóa 1: Lấy tất cả tên đăng nhập hiện tại một lần duy nhất
            let existingSet = new Set<string>();
            try {
                const { results } = await db.prepare("SELECT username FROM accounts").all();
                if (results) {
                    results.forEach((a: any) => {
                        if (a.username) existingSet.add(String(a.username).toLowerCase().trim());
                    });
                }
            } catch (e) {
                console.warn("Could not pre-fetch usernames, falling back:", e);
            }

            let lastPassword = "";
            let lastHashed = "";

            for (const item of list) {
                try {
                    let { user_id, username, password, role, is_active, expiry_date, full_name, lop, target_audience } = item;
                    if (!username || !password) {
                        failed.push({ user_id, full_name, error: "Thiếu tên đăng nhập hoặc mật khẩu" });
                        continue;
                    }
                    username = String(username).trim();
                    let finalUsername = username;
                    let suffix = 1;
                    
                    // Tối ưu hóa 2: Kiểm tra trùng lặp trong bộ nhớ thay vì truy vấn DB nhiều lần
                    while (existingSet.has(finalUsername.toLowerCase())) {
                        finalUsername = `${username}${suffix++}`;
                    }
                    existingSet.add(finalUsername.toLowerCase());

                    // Tối ưu hóa 3: Tránh mã hóa lặp đi lặp lại cùng một mật khẩu mặc định (PBKDF2 rất tốn CPU)
                    let hashedPassword = "";
                    if (password === lastPassword && lastHashed) {
                        hashedPassword = lastHashed;
                    } else {
                        hashedPassword = await hashPasswordPBKDF2(password);
                        lastPassword = password;
                        lastHashed = hashedPassword;
                    }

                    const id = crypto.randomUUID();
                    const activeVal = (is_active !== false && is_active !== 0 && is_active !== 'false') ? 1 : 0;
                    
                    const sql = "INSERT INTO accounts (id, user_id, username, password, role, is_active, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
                    await db.prepare(sql).bind(
                        id,
                        user_id || id,
                        finalUsername,
                        hashedPassword,
                        role || 'user',
                        activeVal,
                        expiry_date || null,
                        new Date().toISOString()
                    ).run();

                    created.push({
                        id,
                        user_id: user_id || id,
                        username: finalUsername,
                        password,
                        full_name: full_name || '',
                        lop: lop || '',
                        target_audience: target_audience || (role === 'teacher' ? 'Giáo viên' : 'Học sinh'),
                        role: role || 'user'
                    });
                } catch(err: any) {
                    failed.push({ user_id: item.user_id, full_name: item.full_name, error: err.message || "Lỗi tạo tài khoản" });
                }
            }
            return new Response(JSON.stringify({ data: { created, failed }, error: null }), { status: 201, headers: corsHeaders });
        }

        const { user_id, username, password, role, is_active, expiry_date } = body;
        if (!username || !password) {
            return new Response(JSON.stringify({ error: "Thiếu thông tin tài khoản hoặc mật khẩu bắt buộc" }), { status: 400, headers: corsHeaders });
        }

        const { results } = await db.prepare("SELECT id FROM accounts WHERE username = ?").bind(username.trim()).all();
        if (results && results.length > 0) {
            return new Response(JSON.stringify({ error: "Tên đăng nhập đã tồn tại!" }), { status: 400, headers: corsHeaders });
        }

        const hashedPassword = await hashPasswordPBKDF2(password);
        const id = crypto.randomUUID();
        const activeVal = (is_active !== false && is_active !== 0 && is_active !== 'false') ? 1 : 0;
        
        const sql = "INSERT INTO accounts (id, user_id, username, password, role, is_active, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        await db.prepare(sql).bind(
            id,
            user_id || id,
            username.trim(),
            hashedPassword,
            role || 'user',
            activeVal,
            expiry_date || null,
            new Date().toISOString()
        ).run();

        return new Response(JSON.stringify({ data: { id, user_id, username: username.trim() }, error: null }), { status: 201, headers: corsHeaders });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message || "Lỗi DB" }), { status: 500, headers: corsHeaders });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        }
    });
}
