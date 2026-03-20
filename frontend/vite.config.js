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
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@twilio/voice-sdk')) return 'twilio';
          if (id.includes('@supabase/supabase-js')) return 'supabase';
          return 'vendor';
        },
      },
    },
  },
});
