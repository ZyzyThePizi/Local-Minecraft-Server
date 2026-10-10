import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Content Security Policy for the published hub. The hub keeps sign-ins to several machines in one
 * origin, so injected script would reach all of them: scripts only from this site, and network
 * calls only over https (any machine address) or to this computer.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  'connect-src https: http://127.0.0.1:* http://localhost:*',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'hub-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// Served from GitHub Pages at https://zyzythepizi.github.io/Local-Minecraft-Server/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/Local-Minecraft-Server/',
  plugins: [react(), tailwindcss(), csp()],
  // The 3D world (three.js) is one lazy chunk by design, loaded after the first paint.
  build: { chunkSizeWarningLimit: 650 },
});
