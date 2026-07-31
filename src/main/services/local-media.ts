import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_MEDIA_SCHEME } from '../../shared/media-url';

export { LOCAL_MEDIA_SCHEME, toLocalMediaUrl } from '../../shared/media-url';

/**
 * Must run before app.ready — allows <img>/<video> from the Vite http origin
 * to load project files that live under userData (file:// is blocked there).
 */
export function registerLocalMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

function resolveMediaPath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);
    const fromQuery = url.searchParams.get('path');
    if (!fromQuery) return null;
    const filePath = path.normalize(decodeURIComponent(fromQuery));
    return path.isAbsolute(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

export function installLocalMediaProtocol(): void {
  // registerFileProtocol gives Chromium proper Range/stream support for <video>.
  // protocol.handle + net.fetch often yields a black/unplayable Final preview.
  protocol.registerFileProtocol(LOCAL_MEDIA_SCHEME, (request, callback) => {
    try {
      const filePath = resolveMediaPath(request.url);
      if (!filePath || !fs.existsSync(filePath)) {
        callback({ error: -6 }); // FILE_NOT_FOUND
        return;
      }
      callback({ path: filePath });
    } catch {
      callback({ error: -2 }); // FAILED
    }
  });
}
