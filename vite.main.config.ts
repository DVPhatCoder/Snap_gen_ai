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
        'ffmpeg-static',
        'ffprobe-static',
        'fluent-ffmpeg',
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
