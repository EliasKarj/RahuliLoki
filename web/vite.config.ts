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
    /**
     * Never inline a font, however small the subset file is.
     *
     * Vite base64s any asset under 4 kB into the stylesheet, and one Cinzel subset is under it.
     * The page's Content-Security-Policy says `font-src 'self'`, which a `data:` URI is not, so
     * the browser refused to load exactly one face and the console said so on every load.
     *
     * Fixing it here rather than by adding `data:` to the policy: the policy is right — a font
     * should come from this origin — and it is worth more than four kilobytes of request.
     */
    assetsInlineLimit: (filePath: string) => (/\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined),
    rollupOptions: {
      output: {
        // React and Recharts change far less often than the app does. One vendor chunk keeps
        // the app bundle small enough to re-download on every deploy without thinking about it.
        manualChunks: (id: string) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
