import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.js',
    injectRegister: 'auto',
    manifest: false,
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,png,svg,wav,json}'],
    },
  })],
  server: {
    host: true,
    port: 3000,
    // Debugging runs the real UI from source against a real backend: the
    // serverless functions in api/ are not run by Vite, so /api is sent to a
    // deployment instead. Sessions are Bearer tokens, not cookies, so nothing
    // else has to be rewritten. Dev only; the production build is untouched.
    proxy: {
      '/api': {
        target: process.env.VOCIVO_API_ORIGIN || 'https://vocivo.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // The shared telephony vendor bundle is intentionally kept together so
    // SIP/WebRTC libraries are loaded once across the multi-page frontend.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: 'index.html',
        landing: 'landing.html',
        platform: 'platform.html',
        business: 'business.html',
        whyVocivo: 'why-vocivo.html',
        pricing: 'pricing.html',
        security: 'security.html',
        contact: 'contact.html',
        video: 'video.html',
        enroll: 'enroll.html',
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          return 'vendor';
        },
      },
    },
  },
});
