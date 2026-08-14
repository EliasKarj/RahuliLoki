import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the SPA runs on its own port; in production Fastify serves it from the
    // same origin, so the app only ever talks to a relative /api.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // React and Recharts change far less often than the app does. One vendor chunk keeps
        // the app bundle small enough to re-download on every deploy without thinking about it.
        manualChunks: (id: string) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
