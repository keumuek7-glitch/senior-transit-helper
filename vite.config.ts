import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 프론트(5173) → /api 요청은 backend-proxy(기본 8787)로 넘깁니다.
const apiPort = process.env.API_PORT ?? '8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
