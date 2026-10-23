import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const buildTimestamp = (() => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
})();

export default defineConfig({
  plugins: [tailwindcss(), {
    name: 'exclude-private-server-artifacts',
    closeBundle() {
      const walk=(dir:string)=>{if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){
        const file=path.join(dir,item.name);
        if(item.isDirectory())walk(file);
        else if(/\.(sql|db|sqlite|sqlite3|cjs|map)$/i.test(item.name)||item.name.startsWith('.env'))fs.unlinkSync(file);
      }};
      walk(path.resolve('dist'));
    }
  }],
  define: {
    '__APP_BUILD_TIME__': JSON.stringify(buildTimestamp),
    'process.env.APP_URL': JSON.stringify(process.env.APP_URL),
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: ['localhost','127.0.0.1']
  }
});
