import { defineConfig, type Plugin } from 'vite';
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

const appBuildId = String(
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.COMMIT_SHA ||
  `local-${Date.now()}`
);
const appBuildIso = new Date().toISOString();

const appVersionPlugin: Plugin = {
  name: 'app-version-manifest',
  configureServer(server) {
    server.middlewares.use('/version.json', (_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.end(JSON.stringify({
        version: appBuildId,
        buildTime: buildTimestamp,
        buildIso: appBuildIso
      }));
    });
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({
        version: appBuildId,
        buildTime: buildTimestamp,
        buildIso: appBuildIso
      }, null, 2)
    });
  },
  transformIndexHtml(html) {
    return html.replace(/__APP_BUILD_ID__/g, appBuildId);
  }
};

export default defineConfig({
  plugins: [tailwindcss(), appVersionPlugin],
  define: {
    '__APP_BUILD_ID__': JSON.stringify(appBuildId),
    '__APP_BUILD_TIME__': JSON.stringify(buildTimestamp),
    'process.env.GEMINI_API_KEY': JSON.stringify(process.env.GEMINI_API_KEY),
    'process.env.APP_URL': JSON.stringify(process.env.APP_URL),
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true
  }
});
