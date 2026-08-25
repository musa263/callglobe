import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: { main: 'index.html', video: 'video.html', enroll: 'enroll.html' },
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
