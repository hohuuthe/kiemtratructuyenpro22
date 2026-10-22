const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const oldGetRealIp = `  const getRealIp = (req: any) => {
    // Ưu tiên đọc IP thực từ Header đặc quyền của Cloudflare
    return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
  };`;

const newGetRealIp = `  const getRealIp = (req: any) => {
    // Ưu tiên đọc IP thực từ Header đặc quyền của Cloudflare
    let ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '';
    if (typeof ip === 'string') {
      return ip.split(',')[0].trim(); // Chống mạo danh IP qua chuỗi phẩy (Header Injection)
    }
    return String(ip);
  };`;

if (content.includes(oldGetRealIp)) {
    content = content.replace(oldGetRealIp, newGetRealIp);
    fs.writeFileSync('server.ts', content);
    console.log("Patched getRealIp successfully!");
} else {
    console.log("Could not find old getRealIp string.");
}
