require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

async function fixTitle() {
    if (!process.env.DATABASE_URL) {
        console.log("No DB URL");
        return;
    }
    try {
        const sql = neon(process.env.DATABASE_URL);
        const result = await sql\`
            UPDATE app_settings 
            SET app_title = 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN'
            WHERE app_title = 'Hệ Thống Khảo Sát & Đánh Giá Năng Lực Trực Tuyến'
        \`;
        console.log("Updated DB rows:", result);
    } catch(e) {
        console.log("DB Error:", e.message);
    }
}
fixTitle();
