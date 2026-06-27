import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend calls ONLY the same-origin backend API (/api). In dev, proxy it
// to the local agent-api. Vite does not polyfill node built-ins, which is one of
// the layers preventing accidental server-only imports in the browser bundle.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: { outDir: 'dist' },
});
