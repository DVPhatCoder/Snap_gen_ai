/** Custom scheme so renderer (Vite http://) can load project files on disk. */
export const LOCAL_MEDIA_SCHEME = 'sgmedia';

/** Absolute disk path → URL for <img>/<video src>. */
export function toLocalMediaUrl(filePath: string): string {
  if (!filePath) return '';
  if (filePath.startsWith(`${LOCAL_MEDIA_SCHEME}://`)) return filePath;
  // Query form is the most reliable for Windows drive letters.
  // Streaming/Range for <video> comes from registerFileProtocol on the main side.
  return `${LOCAL_MEDIA_SCHEME}://local/?path=${encodeURIComponent(filePath)}`;
}
