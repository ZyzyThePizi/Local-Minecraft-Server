import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served from GitHub Pages at https://zyzythepizi.github.io/minecraft/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/minecraft/',
  plugins: [react(), tailwindcss()],
});
