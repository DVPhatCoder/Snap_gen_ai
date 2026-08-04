import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';

/**
 * Electron Forge + Vite mặc định KHÔNG đóng gói node_modules.
 * Các package đánh dấu `external` trong vite.main.config phải được giữ lại ở đây.
 */
const KEEP_NODE_MODULES = [
  // Binary / native (external trong Vite)
  'ffmpeg-static',
  'ffprobe-static',
  'sharp',
  '@img',
  '@pilio',
  // Deps runtime của ffmpeg-static / ffprobe-static (nếu còn require lúc install/load)
  'env-paths',
  'http-response-object',
  'parse-cache-control',
  'progress',
  'https-proxy-agent',
  'agent-base',
  'debug',
  'ms',
  // sharp helpers
  'detect-libc',
  'semver',
  'color',
  'color-string',
  'color-convert',
  'color-name',
  'simple-swizzle',
  'is-arrayish',
];

function shouldKeepNodeModule(filePath: string): boolean {
  return KEEP_NODE_MODULES.some((name) => {
    const base = `/node_modules/${name}`;
    return filePath === base || filePath.startsWith(`${base}/`);
  });
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      // Binary phải nằm ngoài asar thì mới chạy được
      unpack: '**/node_modules/{ffmpeg-static,ffprobe-static,sharp,@img,@pilio}/**',
    },
    // Vite plugin ignore gần như mọi thứ trừ .vite — override để giữ external deps.
    ignore: (file: string) => {
      if (!file) return false;
      if (file === '/package.json') return false;
      if (file.startsWith('/.vite')) return false;
      // Phải giữ thư mục gốc /node_modules, nếu không packager bỏ cả cây.
      if (file === '/node_modules') return false;
      if (file.startsWith('/node_modules/')) {
        return !shouldKeepNodeModule(file);
      }
      // Bỏ src, tests, docs… khỏi bản đóng gói
      return true;
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerDMG({}, ['darwin']),
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
