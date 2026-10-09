import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served from GitHub Pages at https://zyzythepizi.github.io/Local-Minecraft-Server/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/Local-Minecraft-Server/',
  plugins: [react(), tailwindcss()],
  // The 3D world (three.js) is one lazy chunk by design, loaded after the first paint.
  build: { chunkSizeWarningLimit: 650 },
});
