require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function fixTitle() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.log("No Supabase credentials");
        return;
    }
    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data, error } = await supabase
            .from('app_settings')
            .update({ app_title: 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN' })
            .in('app_title', ['Hệ Thống Khảo Sát & Đánh Giá Năng Lực Trực Tuyến', 'PHẦN MỀM KIỂM TRA TRẮC NGHIỆM', 'Hệ thống khảo sát & đánh giá năng lực trực tuyến']);
            
        console.log("Updated DB:", { error, data });
    } catch(e) {
        console.log("DB Error:", e.message);
    }
}
fixTitle();
