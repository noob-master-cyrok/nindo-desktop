import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/// Adds the Content-Security-Policy to the built page only; the dev server
/// needs inline scripts for hot reload.
function csp(supabaseUrl: string): Plugin {
  const host = supabaseUrl ? new URL(supabaseUrl).host : '';
  const connect = host ? `'self' https://${host} wss://${host}` : `'self'`;
  const policy = [
    `default-src 'self'`,
    `script-src 'self'`,
    `style-src 'self'`,
    `img-src 'self' data:`,
    `connect-src ${connect}`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ');
  return {
    name: 'nindo-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    plugins: [react(), csp(env.VITE_SUPABASE_URL ?? '')],
    build: { sourcemap: false, chunkSizeWarningLimit: 700 },
    test: { include: ['tests/**/*.test.ts'] },
  };
});
