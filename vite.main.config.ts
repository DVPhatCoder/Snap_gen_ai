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
      external: ['ffmpeg-static', 'fluent-ffmpeg', 'electron'],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
