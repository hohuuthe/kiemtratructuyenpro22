import { normalizeVietnamExpiryForStorage } from '../../src/account-expiry';
import { verifyAuthSession, getDynamicSecret, hashPasswordPBKDF2, verifyPassword, getDatabase, checkIsAdmin, checkIsTeacherOrAdmin } from './exam/utils';

export async function onRequestGet(context: any) {
    const { request, env } = context;
    const db = getDatabase(context);
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store, max-age=0'
    };

    const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }
    const user: any = await verifyAuthSession(authHeader.slice(7), SECRET, db);
    if (!user) {
        return new Response(JSON.stringify({ error: 'Phiên đăng nhập không hợp lệ' }), { status: 401, headers: corsHeaders });
    }

    const isAdmin = checkIsAdmin(user);
    const isTeacher = checkIsTeacherOrAdmin(user) && !isAdmin;
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const pageParam = url.searchParams.get('page');
    const requestedSnapshot = String(url.searchParams.get('snapshot') || '').trim();

    let limit = -1;
    if (limitParam !== null && !['all','0','-1'].includes(limitParam)) {
        const parsed = parseInt(limitParam, 10);
        if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 5000);
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

    const projection = `
      SELECT a.id, a.user_id, a.username, a.role, a.is_active, a.expiry_date, a.created_at,
             u.full_name, u.phone_number, u.donvi, u.lop, u.target_audience, u.occupation
      FROM accounts a
      LEFT JOIN users u ON u.id = COALESCE(a.user_id, a.id)
    `;

    try {
        let rows: any[] = [];
        let total = 0;
        let snapshot = '';
        let orderSql = `CASE
          WHEN LOWER(TRIM(COALESCE(a.role,'')))='admin' OR LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('quản trị viên','admin') THEN 0
          WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('giáo viên','teacher') OR LOWER(TRIM(COALESCE(a.role,''))) IN ('teacher','giáo viên') THEN 1
          WHEN LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student') THEN 2
          ELSE 3 END,
          a.created_at DESC, a.id DESC`;
        let whereSql = '';
        let binds: any[] = [];

        if (isAdmin) {
            whereSql = '';
        } else if (isTeacher) {
            const selfId = String(user.user_id || user.id || '');
            const accountId = String(user.id || selfId);
            whereSql = `
              WHERE LOWER(TRIM(COALESCE(u.target_audience,''))) IN ('học sinh','student')
                AND EXISTS (
                  SELECT 1 FROM teacher_classes tc
                  WHERE (tc.teacher_id = ? OR tc.teacher_id = ?)
                    AND LOWER(TRIM(tc.class_name)) = LOWER(TRIM(COALESCE(u.lop,'')))
                    AND LOWER(TRIM(COALESCE(tc.donvi,''))) = LOWER(TRIM(COALESCE(u.donvi,'')))
                )`;
            binds = [selfId, accountId];
            orderSql = 'LOWER(COALESCE(u.full_name,\'\')) ASC, LOWER(COALESCE(a.username,\'\')) ASC, a.id DESC';
        } else {
            const selfId = String(user.user_id || user.id || '');
            const accountId = String(user.id || selfId);
            const self: any = await db.prepare(projection + `
              WHERE a.id = ? OR a.user_id = ?
              ORDER BY CASE WHEN a.id = ? THEN 0 ELSE 1 END, a.created_at DESC, a.id DESC
              LIMIT 1
            `).bind(accountId, selfId, accountId).first();
            rows = self ? [self] : [];
            total = rows.length;
            snapshot = rows.length ? String(rows[0].id) : '';
            return new Response(JSON.stringify({
                data: rows, total, limit, offset: 0, has_more: false, snapshot,
                role_scope: 'student', error: null
            }), { status: 200, headers: corsHeaders });
        }

        const metaSql = `
          SELECT COUNT(*)::int AS total,
                 MD5(COALESCE(STRING_AGG(a.id, '|' ORDER BY ${orderSql}), '')) AS snapshot
          FROM accounts a
          LEFT JOIN users u ON u.id = COALESCE(a.user_id, a.id)
          ${whereSql}`;
        const metaStmt = db.prepare(metaSql);
        const meta: any = binds.length ? await metaStmt.bind(...binds).first() : await metaStmt.first();
        total = Number(meta?.total || 0);
        snapshot = String(meta?.snapshot || '');

        if (requestedSnapshot && requestedSnapshot !== snapshot) {
            return new Response(JSON.stringify({
                error: 'Phạm vi dữ liệu đã thay đổi trong khi đang phân trang. Cần tải lại từ trang đầu.',
                code: 'PAGINATION_SCOPE_CHANGED',
                snapshot,
                total
            }), { status: 409, headers: corsHeaders });
        }

        const dataSql = projection + whereSql + ` ORDER BY ${orderSql}${paginationClause}`;
        const dataStmt = db.prepare(dataSql);
        const res: any = binds.length ? await dataStmt.bind(...binds).all() : await dataStmt.all();
        rows = res.results || [];

        // Re-read the full scope fingerprint after reading the page. This closes
        // the race where membership/order changes between the first meta query
        // and the page SELECT itself.
        const verifyStmt = db.prepare(metaSql);
        const verifyMeta: any = binds.length ? await verifyStmt.bind(...binds).first() : await verifyStmt.first();
        const verifyTotal = Number(verifyMeta?.total || 0);
        const verifySnapshot = String(verifyMeta?.snapshot || '');
        if (verifyTotal !== total || verifySnapshot !== snapshot) {
            return new Response(JSON.stringify({
                error: 'Phạm vi dữ liệu thay đổi ngay trong lúc đọc trang. Cần tải lại từ đầu.',
                code: 'PAGINATION_SCOPE_CHANGED',
                snapshot: verifySnapshot,
                total: verifyTotal
            }), { status: 409, headers: corsHeaders });
        }

        const unique = new Set(rows.map((row: any) => String(row?.id || '')));
        if (unique.size !== rows.length || unique.has('')) {
            return new Response(JSON.stringify({
                error: 'Phân trang tài khoản phát hiện bản ghi trùng hoặc thiếu ID.',
                code: 'PAGINATION_PAGE_INVALID'
            }), { status: 500, headers: corsHeaders });
        }

        return new Response(JSON.stringify({
            data: rows,
            total,
            limit,
            offset,
            has_more: limit > 0 ? offset + rows.length < total : false,
            snapshot,
            role_scope: isAdmin ? 'admin' : 'teacher',
            error: null
        }), { status: 200, headers: corsHeaders });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message || 'Lỗi DB' }), { status: 500, headers: corsHeaders });
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
    const user = await verifyAuthSession(token, SECRET, db);
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
                        if (!(await verifyPassword(String(password), hashedPassword))) {
                            throw new Error("Không thể xác minh mật khẩu vừa mã hóa");
                        }
                        lastPassword = password;
                        lastHashed = hashedPassword;
                    }

                    const id = crypto.randomUUID();
                    const activeVal = (is_active !== false && is_active !== 0 && is_active !== 'false') ? 1 : 0;
                    const normalizedExpiry = normalizeVietnamExpiryForStorage(expiry_date);
                    
                    const sql = "INSERT INTO accounts (id, user_id, username, password, role, is_active, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
                    await db.prepare(sql).bind(
                        id,
                        user_id || id,
                        finalUsername,
                        hashedPassword,
                        role || 'user',
                        activeVal,
                        normalizedExpiry,
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
        if (!(await verifyPassword(String(password), hashedPassword))) {
            return new Response(JSON.stringify({ error: "Không thể xác minh mật khẩu vừa mã hóa" }), { status: 500, headers: corsHeaders });
        }
        const id = crypto.randomUUID();
        const activeVal = (is_active !== false && is_active !== 0 && is_active !== 'false') ? 1 : 0;
        const normalizedExpiry = normalizeVietnamExpiryForStorage(expiry_date);
        
        const sql = "INSERT INTO accounts (id, user_id, username, password, role, is_active, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        await db.prepare(sql).bind(
            id,
            user_id || id,
            username.trim(),
            hashedPassword,
            role || 'user',
            activeVal,
            normalizedExpiry,
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
