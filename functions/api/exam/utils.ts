import { createNeonD1Shim, getEffectiveDb } from '../neon-adapter';

export function getDatabase(envOrContext: any, requestOrSlug?: any) {
    return getEffectiveDb(envOrContext, requestOrSlug);
}

export { getEffectiveDb };

export function b64EncodeUnicode(str: string) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
        return String.fromCharCode(parseInt(p1, 16));
    })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function b64DecodeUnicode(str: string) {
    return decodeURIComponent(Array.prototype.map.call(atob(str.replace(/-/g, "+").replace(/_/g, "/")), function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}

export async function signJWT(payload: any, secret: string) {
    const textEncoder = new TextEncoder();
    const header = { alg: "HS256", typ: "JWT" };
    
    const encodedHeader = b64EncodeUnicode(JSON.stringify(header));
    const encodedPayload = b64EncodeUnicode(JSON.stringify(payload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    
    const key = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    
    const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(dataToSign));
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    
    return `${dataToSign}.${encodedSignature}`;
}

export async function verifyJWT(token: string, secret: string) {
    const textEncoder = new TextEncoder();
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    
    const key = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
    );
    
    const signatureBytes = Uint8Array.from(atob(encodedSignature.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    
    const isValid = await crypto.subtle.verify("HMAC", key, signatureBytes, textEncoder.encode(dataToSign));
    if (!isValid) return null;
    
    try {
        const claims = JSON.parse(b64DecodeUnicode(encodedPayload));
        const now = Math.floor(Date.now() / 1000);
        if (claims.exp !== undefined && (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now)) return null;
        if (claims.nbf !== undefined && Number(claims.nbf) > now) return null;
        return claims;
    } catch {
        return null;
    }
}

/**
 * Bind authorization to the current account record.
 * Re-evaluating this fingerprint on every privileged API request revokes all older
 * tokens as soon as an account is disabled, its password/role expires or its
 * linked profile permission changes. Legacy JWTs without proof fail closed.
 */
export function isLiveAccount(row: any): boolean {
    if (!row || !row.id || !row.password) return false;
    const active = (value: any) => value === undefined || value === null ||
      !['0', 'false', 'disabled'].includes(String(value).toLowerCase().trim());
    if (!active(row.is_active) || !active(row.profile_active)) return false;
    const now = Date.now();
    const notExpired = (value: any) => {
      if (!value) return true;
      const raw = String(value).trim();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? raw + 'T23:59:59.999+07:00' : raw;
      const at = Date.parse(date);
      return Number.isFinite(at) && at >= now;
    };
    return notExpired(row.expiry_date) && notExpired(row.profile_expiry_date);
}

async function accountProof(account: any, secret: string, tenantKey = ''): Promise<string> {
    const parts = [
      tenantKey,
      account.id, account.user_id || account.id, account.password,
      account.role || '', account.is_active ?? 1, account.expiry_date || '',
      account.target_audience || '', account.profile_active ?? 1,
      account.profile_expiry_date || ''
    ].map(value => String(value));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key,
      new TextEncoder().encode(JSON.stringify(parts)));
    return Array.from(new Uint8Array(signature)).map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function signAuthSession(account: any, claims: any, secret: string, tenantKey = ''): Promise<string> {
    if (!isLiveAccount(account)) throw new Error('Account inactive or expired');
    const now = Math.floor(Date.now() / 1000);
    const proof = await accountProof(account, secret, tenantKey);
    return signJWT({...claims, tokenType:'auth', authProof:proof, iat:now, exp:now + 12*3600}, secret);
}
export async function verifyAuthSession(token: string, secret: string, db: any): Promise<any | null> {
    if (!db) return null;
    const decoded = await verifyJWT(token, secret);
    if (!decoded || decoded.tokenType !== 'auth' || !decoded.authProof ||
        !Number.isFinite(Number(decoded.exp))) return null;
    try {
      const account: any = await db.prepare(`
        SELECT a.id, a.user_id, a.username, a.password, a.role, a.is_active, a.expiry_date,
               u.full_name, u.target_audience, u.donvi, u.lop,
               u.is_active AS profile_active, u.expiry_date AS profile_expiry_date
        FROM accounts a LEFT JOIN users u ON u.id = COALESCE(a.user_id, a.id)
        WHERE a.id = ? LIMIT 1
      `).bind(decoded.id).first();
      if (!isLiveAccount(account)) return null;
      const actual = await accountProof(account, secret, String(db.connectionUrl || ''));
      if (actual !== decoded.authProof) return null;
      const audience = account.target_audience ||
        (String(account.role).toLowerCase() === 'admin' ? 'Quản trị viên' :
        ['teacher','giáo viên'].includes(String(account.role).toLowerCase()) ? 'Giáo viên' : 'Học sinh');
      return {
        ...decoded, id:account.id, user_id:account.user_id || account.id,
        username:account.username, role:account.role, target_audience:audience,
        full_name:account.full_name || account.username,
        donvi:account.donvi || '', lop:account.lop || ''
      };
    } catch (err) {
      console.error('Authorization state validation unavailable');
      return null; // Never authorize when the account database cannot be verified.
    }
}

const initializedDatabaseUrls = new Set<string>();

export async function ensureD1SchemaAndIndexes(db: any) {
    if (!db) return;
    const dbKey = db.connectionUrl || 'default';
    if (initializedDatabaseUrls.has(dbKey)) return;

    try {
        // 1. Tạo đầy đủ các bảng dữ liệu nếu chưa tồn tại
        const tableStatements = [
            `CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                full_name TEXT,
                phone_number TEXT,
                gender TEXT,
                dob TEXT,
                address TEXT,
                donvi TEXT,
                lop TEXT,
                occupation TEXT,
                target_audience TEXT DEFAULT 'Học sinh',
                payment_status TEXT DEFAULT 'Chưa thanh toán',
                payment_method TEXT,
                is_active INTEGER DEFAULT 1,
                expiry_date TEXT,
                created_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                is_active INTEGER DEFAULT 1,
                expiry_date TEXT,
                created_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS results (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                student_name TEXT,
                student_class TEXT,
                lop TEXT,
                don_vi TEXT,
                exam_name TEXT,
                exam_id TEXT,
                score REAL,
                time_taken INTEGER,
                correct_count INTEGER,
                total_questions INTEGER,
                details TEXT,
                loai_thi_sinh TEXT,
                cheat_warning_count INTEGER DEFAULT 0,
                ai_grading_summary TEXT,
                created_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS questions (
                id TEXT PRIMARY KEY,
                type TEXT,
                level TEXT,
                lesson TEXT,
                content TEXT,
                options TEXT,
                answer TEXT,
                image TEXT,
                creator_id TEXT,
                created_at TEXT,
                updated_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS exam_configs (
                id TEXT PRIMARY KEY,
                name TEXT,
                creator_id TEXT,
                time_limit INTEGER,
                count_41 INTEGER,
                count_tf4 INTEGER,
                count_sq INTEGER,
                count_tl INTEGER,
                points_41 REAL,
                points_tf4 REAL,
                points_sq REAL,
                points_tl REAL,
                selected_lessons TEXT,
                tf4_scoring_mode TEXT,
                tf4_points TEXT,
                access_control TEXT,
                immediate_feedback INTEGER DEFAULT 1,
                show_score INTEGER DEFAULT 1,
                show_details INTEGER DEFAULT 1,
                sq_case_sensitive INTEGER DEFAULT 0,
                sq_punctuation_sensitive INTEGER DEFAULT 0,
                auto_grade_essay INTEGER DEFAULT 0,
                counts_detail TEXT,
                chedodethi TEXT,
                mabaomatdethi TEXT,
                target_lop TEXT,
                lop TEXT,
                target_donvi TEXT,
                donvi TEXT,
                tg_bd TEXT,
                tg_kt TEXT,
                ai_prompt TEXT,
                is_shared_results INTEGER DEFAULT 0,
                ai_grading_key TEXT,
                max_attempts INTEGER DEFAULT 0,
                max_cheat_warnings INTEGER DEFAULT 5,
                tieu_de_bai_thi TEXT,
                created_at TEXT,
                updated_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (
                token_hash TEXT PRIMARY KEY,
                exam_id TEXT,
                student_name TEXT,
                submitted_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS _internal_secrets (
                key TEXT PRIMARY KEY,
                value TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY,
                show_results_details INTEGER DEFAULT 1,
                allow_ranking_details INTEGER DEFAULT 1,
                show_delete_selected_ranking INTEGER DEFAULT 0,
                immediate_feedback INTEGER DEFAULT 1,
                sq_case_sensitive INTEGER DEFAULT 0,
                sq_punctuation_sensitive INTEGER DEFAULT 0,
                question_font_size INTEGER DEFAULT 18,
                answer_font_size INTEGER DEFAULT 16,
                display_mode TEXT DEFAULT 'standard',
                app_title TEXT DEFAULT 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN',
                author_info TEXT DEFAULT 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895',
                ai_prompt TEXT DEFAULT '',
                ai_appraise_prompt TEXT DEFAULT '',
                ai_grading_key TEXT DEFAULT '',
                qr_code_url TEXT DEFAULT ''
            )`,
            `CREATE TABLE IF NOT EXISTS teacher_classes (
                id TEXT PRIMARY KEY,
                teacher_id TEXT NOT NULL,
                teacher_name TEXT,
                class_name TEXT NOT NULL,
                donvi TEXT NOT NULL,
                role TEXT DEFAULT 'bo_mon',
                subject TEXT DEFAULT '',
                created_at TEXT,
                UNIQUE(teacher_id, class_name, donvi)
            )`
        ];

        for (const tbl of tableStatements) {
            try { await db.prepare(tbl).run(); } catch {}
        }

        try {
            await db.prepare(`
                INSERT INTO app_settings (
                    id, show_results_details, allow_ranking_details, show_delete_selected_ranking,
                    immediate_feedback, sq_case_sensitive, sq_punctuation_sensitive,
                    question_font_size, answer_font_size, display_mode, app_title, author_info,
                    ai_prompt, ai_appraise_prompt, ai_grading_key, qr_code_url
                ) VALUES (1, 1, 1, 1, 1, 0, 0, 18, 16, 'standard', 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN', 'Phát triển bởi: Hồ Hữu Thế - 0935 078 895', '', '', '', '')
                ON CONFLICT (id) DO NOTHING
            `).run();
        } catch {}

        // 2. Migration bổ sung cột nếu bảng đã tồn tại từ trước
        const alterStatements = [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS lop TEXT",
            "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS lop TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS don_vi TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS cheat_warning_count INTEGER DEFAULT 0",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS ai_grading_summary TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS submission_token_hash TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'completed'",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_attempts INTEGER DEFAULT 0",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_retry_at TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_lease_token TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_lease_until TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_error_code TEXT",
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_updated_at TEXT",
            "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS target_lop TEXT",
            "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS lop TEXT",
            "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 0",
            "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS is_shared_results INTEGER DEFAULT 0",
            "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS max_cheat_warnings INTEGER DEFAULT 5",
            "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS tieu_de_bai_thi TEXT",
            "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS created_at TEXT",
            "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS qr_code_url TEXT DEFAULT ''"
        ];
        for (const alt of alterStatements) {
            try { await db.prepare(alt).run(); } catch {}
        }

        // 3. Hệ thống chỉ mục (INDEX) tối ưu hóa 100%, phủ kín mọi câu truy vấn, chống full table scan
        const indexStatements = [
            // --- BẢNG ACCOUNTS ---
            "CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username)",
            "CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at)",
            "CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role)",
            "CREATE INDEX IF NOT EXISTS idx_accounts_user_created ON accounts(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_accounts_username_active ON accounts(username, is_active)",

            // --- BẢNG USERS ---
            "CREATE INDEX IF NOT EXISTS idx_users_donvi ON users(donvi)",
            "CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)",
            "CREATE INDEX IF NOT EXISTS idx_users_lop ON users(lop)",
            "CREATE INDEX IF NOT EXISTS idx_users_target_audience ON users(target_audience)",
            "CREATE INDEX IF NOT EXISTS idx_users_donvi_audience ON users(donvi, target_audience)",
            "CREATE INDEX IF NOT EXISTS idx_users_audience_created ON users(target_audience, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_users_donvi_audience_created ON users(donvi, target_audience, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_users_donvi_lop ON users(donvi, lop)",
            "CREATE INDEX IF NOT EXISTS idx_users_full_name ON users(full_name)",
            "CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number)",

            // --- BẢNG RESULTS ---
            "CREATE INDEX IF NOT EXISTS idx_results_exam_id ON results(exam_id)",
            "CREATE INDEX IF NOT EXISTS idx_results_user_id ON results(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_results_created_at ON results(created_at)",
            "CREATE INDEX IF NOT EXISTS idx_results_exam_created ON results(exam_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_results_user_created ON results(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_results_student_name ON results(student_name)",
            "CREATE INDEX IF NOT EXISTS idx_results_student_created ON results(student_name, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_results_exam_student ON results(exam_id, student_name)",
            "CREATE INDEX IF NOT EXISTS idx_results_exam_user ON results(exam_id, user_id)",
            "CREATE INDEX IF NOT EXISTS idx_results_exam_name ON results(exam_name)",
            "CREATE INDEX IF NOT EXISTS idx_results_name_user ON results(exam_name, user_id)",
            "CREATE INDEX IF NOT EXISTS idx_results_name_student ON results(exam_name, student_name)",
            "CREATE INDEX IF NOT EXISTS idx_results_exam_score_time ON results(exam_id, score DESC, time_taken ASC)",
            "CREATE INDEX IF NOT EXISTS idx_results_lop ON results(lop)",

            // --- BẢNG QUESTIONS ---
            "CREATE INDEX IF NOT EXISTS idx_questions_creator_id ON questions(creator_id)",
            "CREATE INDEX IF NOT EXISTS idx_questions_creator_lookup ON questions(creator_id, type, level, lesson)",
            "CREATE INDEX IF NOT EXISTS idx_questions_creator_lesson_type ON questions(creator_id, lesson ASC, type ASC)",
            "CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type)",
            "CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions(lesson)",
            "CREATE INDEX IF NOT EXISTS idx_questions_level ON questions(level)",

            // --- BẢNG EXAM_CONFIGS ---
            "CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_id ON exam_configs(creator_id)",
            "CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_date ON exam_configs(creator_id, updated_at DESC, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_exam_configs_creator_name ON exam_configs(creator_id, name ASC)",
            "CREATE INDEX IF NOT EXISTS idx_exam_configs_name_creator ON exam_configs(name, creator_id)",
            "CREATE INDEX IF NOT EXISTS idx_exam_configs_name ON exam_configs(name)",
            "CREATE INDEX IF NOT EXISTS idx_exam_configs_shared ON exam_configs(is_shared_results)",
            "CREATE INDEX IF NOT EXISTS idx_exam_configs_shared_name ON exam_configs(is_shared_results, name ASC)",

            // --- BẢNG TOKENS & THỐNG KÊ ---
            "CREATE INDEX IF NOT EXISTS idx_tokens_exam_student ON _submitted_exam_tokens(exam_id, student_name)",
            "CREATE INDEX IF NOT EXISTS idx_tokens_submitted_at ON _submitted_exam_tokens(submitted_at DESC)",

            // --- BẢNG TEACHER_CLASSES ---
            "CREATE INDEX IF NOT EXISTS idx_tc_teacher ON teacher_classes(teacher_id)",
            "CREATE INDEX IF NOT EXISTS idx_tc_class ON teacher_classes(class_name, donvi)",
            "CREATE INDEX IF NOT EXISTS idx_tc_donvi ON teacher_classes(donvi)"
        ];

        // Xóa hoàn toàn bảng duytricsdl nếu còn tồn tại trong CSDL
        try {
            await db.prepare("DROP TABLE IF EXISTS duytricsdl CASCADE").run();
        } catch {}

        try {
            await db.batch(indexStatements.map((sql: string) => db.prepare(sql)));
        } catch {
            for (const s of indexStatements) {
                try { await db.prepare(s).run(); } catch {}
            }
        }
        initializedDatabaseUrls.add(dbKey);
    } catch (e) {
        initializedDatabaseUrls.add(dbKey);
    }
}

const secretByDbCache = new Map<string, string>();

export async function getDynamicSecret(db: any, envSecret?: string) {
    const dbKey = db?.connectionUrl || 'default';
    if (secretByDbCache.has(dbKey)) {
        return secretByDbCache.get(dbKey)!;
    }
    if (envSecret && envSecret.trim()) {
        const s = envSecret.trim();
        secretByDbCache.set(dbKey, s);
        return s;
    }
    try {
        if (!db) {
            throw new Error('Database unavailable: refusing insecure JWT fallback');
        }
        await db.prepare("CREATE TABLE IF NOT EXISTS _internal_secrets (key TEXT PRIMARY KEY, value TEXT)").run();
        const { results } = await db.prepare("SELECT value FROM _internal_secrets WHERE key = 'jwt'").all();
        if (results && results.length > 0) {
            const storedSecret = results[0].value;
            secretByDbCache.set(dbKey, storedSecret);
            return storedSecret;
        }
        const newSecret = crypto.randomUUID() + "-" + crypto.randomUUID();
        await db.prepare("INSERT INTO _internal_secrets (key, value) VALUES ('jwt', ?)").bind(newSecret).run();
        secretByDbCache.set(dbKey, newSecret);
        return newSecret;
    } catch (e) {
        throw new Error('Authentication unavailable: secure JWT secret could not be loaded');
    }
}

export async function hashToken(token: string): Promise<string> {
    const textEncoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', textEncoder.encode(token));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ==================== PBKDF2 BANKING-GRADE PASSWORD HASHING ====================
// Chuẩn bảo mật PBKDF2 kết hợp Salt ngẫu nhiên 16 bytes và 100,000 vòng lặp (iterations) với HMAC-SHA256
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LEN_BYTES = 32; // 256 bits

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8Array(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

export async function hashPasswordPBKDF2(password: string, customSaltHex?: string): Promise<string> {
    const textEncoder = new TextEncoder();
    const salt = customSaltHex ? hexToUint8Array(customSaltHex) : crypto.getRandomValues(new Uint8Array(16));
    const saltHex = bufferToHex(salt);

    const passwordKey = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256"
        },
        passwordKey,
        PBKDF2_KEY_LEN_BYTES * 8
    );

    const hashHex = bufferToHex(derivedBits);
    return `pbkdf2:sha256:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    if (!storedHash || !password) return false;

    // 1. Trường hợp mật khẩu lưu chuẩn mới PBKDF2: pbkdf2:sha256:100000:salt:hash
    if (storedHash.startsWith('pbkdf2:sha256:')) {
        const parts = storedHash.split(':');
        if (parts.length !== 5) return false;
        const iterations = parseInt(parts[2], 10) || PBKDF2_ITERATIONS;
        const saltHex = parts[3];
        const expectedHashHex = parts[4];

        const textEncoder = new TextEncoder();
        const salt = hexToUint8Array(saltHex);

        const passwordKey = await crypto.subtle.importKey(
            "raw",
            textEncoder.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveBits"]
        );

        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: iterations,
                hash: "SHA-256"
            },
            passwordKey,
            PBKDF2_KEY_LEN_BYTES * 8
        );

        const derivedHashHex = bufferToHex(derivedBits);
        return derivedHashHex === expectedHashHex;
    }

    // 2. Tương thích ngược với các tài khoản cũ đã lưu dạng SHA-256 thô (64 ký tự hex)
    const textEncoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', textEncoder.encode(password));
    const legacyHex = bufferToHex(hashBuffer);
    return legacyHex.toLowerCase() === storedHash.toLowerCase();
}

export const verifyPasswordPBKDF2 = verifyPassword;

export function checkIsAdmin(user: any): boolean {
    if (!user) return false;
    const role = String(user.role || '').toLowerCase();
    const audience = String(user.target_audience || '').toLowerCase();
    return role === 'admin' || audience === 'admin' || audience === 'quản trị viên';
}

export function checkIsTeacherOrAdmin(user: any): boolean {
    if (!user) return false;
    if (checkIsAdmin(user)) return true;
    const role = String(user.role || '').toLowerCase();
    const audience = String(user.target_audience || '').toLowerCase();
    return role === 'giáo viên' || audience === 'giáo viên' || role === 'teacher';
}

