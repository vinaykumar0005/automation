import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), tailwindcss()],
  base: process.env.NODE_ENV === 'production' ? './' : '/',
  build: {
    outDir: '../../build/renderer',
    emptyOutDir: true,
  },
});