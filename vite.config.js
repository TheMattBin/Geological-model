import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@three': resolve(import.meta.dirname, 'src/three')
    }
  },
  build: {
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html')
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
