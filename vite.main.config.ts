import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    rollupOptions: {
      external: [
        // Pure JS → bundle vào main.js (tránh thiếu node_modules khi package)
        // Binary / native → external + giữ trong forge.config ignore whitelist
        'ffmpeg-static',
        'ffprobe-static',
        'electron',
        'sharp',
        '@pilio/gemini-watermark-remover',
        '@pilio/gemini-watermark-remover/node',
      ],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
