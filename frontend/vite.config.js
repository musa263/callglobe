import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    injectRegister: null,
    manifest: false,
    workbox: {
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [
        /^\/(?:landing|platform|business|why-vocivo|pricing|security|contact)(?:\.html)?$/,
        /^\/enroll(?:\.html)?$/,
        /^\/video(?:\.html)?$/,
      ],
      globPatterns: ['**/*.{js,css,html,png,svg,wav,json}'],
    },
  })],
  server: {
    host: true,
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
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
          if (id.includes('@telnyx/webrtc')) return 'telnyx';
          return 'vendor';
        },
      },
    },
  },
});
