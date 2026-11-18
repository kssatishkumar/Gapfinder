import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :3001 and Vite proxies /api to it, so the app
// always calls same-origin /api/... — the same as behind CloudFront in AWS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
