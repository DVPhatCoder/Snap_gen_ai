import fs from 'node:fs';
import path from 'node:path';
import type { ImageFamily, VideoFamily } from '../../shared/types';

const BASE = 'https://api.snapgen.ai';

export interface SnapgenHistory {
  id?: number;
  uuid: string;
  status: number;
  status_percentage?: number;
  error_message?: string;
  generated_video?: Array<{
    video_url?: string | null;
    duration?: number | null;
  }>;
  generated_image?: Array<{
    image_url?: string | null;
    file_download_url?: string | null;
  }>;
}

export interface GenerateVideoParams {
  apiKey: string;
  family: VideoFamily;
  model: string;
  prompt: string;
  duration: number;
  aspectRatio: string;
  resolution: string;
  mode?: string;
}

export interface GenerateImageParams {
  apiKey: string;
  family: ImageFamily;
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  mode?: string;
}

function videoEndpoint(family: VideoFamily): string {
  const map: Record<VideoFamily, string> = {
    veo: `${BASE}/uapi/v1/video-gen/veo`,
    sora: `${BASE}/uapi/v1/video-gen/sora`,
    grok: `${BASE}/uapi/v1/video-gen/grok`,
    seedance: `${BASE}/uapi/v1/video-gen/seedance`,
    kling: `${BASE}/uapi/v1/video-gen/kling`,
    meta: `${BASE}/uapi/v1/video-gen/meta`,
  };
  return map[family];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function testAccount(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${BASE}/uapi/v1/account`, {
      headers: { 'x-api-key': apiKey },
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, message: 'Snapgen API key hợp lệ.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function generateVideo(params: GenerateVideoParams): Promise<SnapgenHistory> {
  const form = new FormData();
  form.append('prompt', params.prompt);
  form.append('model', params.model);
  form.append('duration', String(params.duration));
  form.append('aspect_ratio', params.aspectRatio);

  if (params.family === 'sora') {
    form.append('resolution', params.resolution);
  } else if (params.family === 'grok') {
    form.append('resolution', params.resolution);
    form.append('mode', params.mode || 'custom');
    form.append('skip_audio', 'true');
  } else if (params.family === 'seedance') {
    form.append('mode', params.mode || 'pro');
  } else if (params.family === 'kling') {
    form.append('mode', params.mode || 'standard');
  } else if (params.family === 'veo') {
    form.append('resolution', params.resolution);
  } else if (params.family === 'meta') {
    form.append('resolution', params.resolution);
  }

  const res = await fetch(videoEndpoint(params.family), {
    method: 'POST',
    headers: { 'x-api-key': params.apiKey },
    body: form,
  });

  const data = (await res.json()) as SnapgenHistory & { detail?: unknown; message?: string };
  if (!res.ok) {
    throw new Error(
      typeof data.message === 'string'
        ? data.message
        : `Snapgen ${params.family} failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  if (!data.uuid) {
    throw new Error(`Snapgen response missing uuid: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

export async function generateImage(params: GenerateImageParams): Promise<SnapgenHistory> {
  const form = new FormData();
  form.append('prompt', params.prompt);

  let url: string;
  if (params.family === 'gpt-image') {
    url = `${BASE}/uapi/v1/imagen/gpt-image-2`;
    form.append('aspect_ratio', params.aspectRatio);
    form.append('mode', params.mode || 'low');
    form.append('resolution', params.resolution);
  } else if (params.family === 'grok-image') {
    url = `${BASE}/uapi/v1/imagen/grok`;
    form.append('orientation', params.aspectRatio);
    form.append('num_result', '1');
    if (params.mode) form.append('mode', params.mode);
  } else {
    url = `${BASE}/uapi/v1/generate_image`;
    form.append('model', params.model);
    form.append('aspect_ratio', params.aspectRatio);
    form.append('resolution', params.resolution);
    form.append('number_of_images', '1');
    form.append('output_format', 'png');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': params.apiKey },
    body: form,
  });

  const data = (await res.json()) as SnapgenHistory & { detail?: unknown; message?: string };
  if (!res.ok) {
    throw new Error(
      typeof data.message === 'string'
        ? data.message
        : `Snapgen image failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  if (!data.uuid) {
    throw new Error(`Snapgen image response missing uuid: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

export interface ExtendVideoParams {
  apiKey: string;
  family: VideoFamily;
  prompt: string;
  refHistory: string;
  duration?: number;
  resolution?: string;
  mode?: string;
}

function extendEndpoint(family: VideoFamily): string | null {
  const map: Partial<Record<VideoFamily, string>> = {
    veo: `${BASE}/uapi/v1/video-extend/veo`,
    grok: `${BASE}/uapi/v1/video-extend/grok`,
    seedance: `${BASE}/uapi/v1/video-extend/seedance`,
    kling: `${BASE}/uapi/v1/video-extend/kling`,
  };
  return map[family] ?? null;
}

export async function extendVideo(params: ExtendVideoParams): Promise<SnapgenHistory> {
  const url = extendEndpoint(params.family);
  if (!url) {
    throw new Error(`Model family ${params.family} không hỗ trợ video extend.`);
  }

  const form = new FormData();
  form.append('prompt', params.prompt);
  form.append('ref_history', params.refHistory);

  if (params.family === 'grok') {
    if (params.duration != null) form.append('duration', String(params.duration));
    if (params.resolution) form.append('resolution', params.resolution);
    if (params.mode) form.append('mode', params.mode);
  } else if (params.family === 'seedance' || params.family === 'kling') {
    form.append('mode', params.mode || 'fast');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': params.apiKey },
    body: form,
  });

  const data = (await res.json()) as SnapgenHistory & { detail?: unknown; message?: string };
  if (!res.ok) {
    throw new Error(
      typeof data.message === 'string'
        ? data.message
        : `Snapgen extend ${params.family} failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  if (!data.uuid) {
    throw new Error(`Snapgen extend missing uuid: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

export async function getHistory(apiKey: string, uuid: string): Promise<SnapgenHistory> {
  const res = await fetch(`${BASE}/uapi/v1/history/${uuid}`, {
    headers: { 'x-api-key': apiKey },
  });
  const data = (await res.json()) as SnapgenHistory;
  if (!res.ok) {
    throw new Error(`History poll failed: HTTP ${res.status}`);
  }
  return data;
}

function extractMediaUrl(hist: SnapgenHistory, kind: 'video' | 'image'): string | null {
  if (kind === 'video') {
    return hist.generated_video?.[0]?.video_url ?? null;
  }
  const img = hist.generated_image?.[0];
  return img?.image_url || img?.file_download_url || null;
}

export async function waitForMedia(
  apiKey: string,
  uuid: string,
  kind: 'video' | 'image',
  onProgress?: (percent: number, status: number) => void,
  timeoutMs = 30 * 60 * 1000
): Promise<SnapgenHistory> {
  const started = Date.now();
  let delay = 4000;

  while (Date.now() - started < timeoutMs) {
    const hist = await getHistory(apiKey, uuid);
    onProgress?.(hist.status_percentage ?? 0, hist.status);

    if (hist.status === 2) {
      const url = extractMediaUrl(hist, kind);
      if (!url) {
        throw new Error(
          kind === 'video'
            ? 'Video completed but no video_url in history.'
            : 'Image completed but no image_url in history.'
        );
      }
      return hist;
    }
    if (hist.status === 3) {
      throw new Error(hist.error_message || `${kind} generation failed.`);
    }

    await sleep(delay);
    delay = Math.min(delay + 2000, 15000);
  }

  throw new Error(`Timed out waiting for Snapgen ${kind}.`);
}

export async function waitForVideo(
  apiKey: string,
  uuid: string,
  onProgress?: (percent: number, status: number) => void,
  timeoutMs = 30 * 60 * 1000
): Promise<SnapgenHistory> {
  return waitForMedia(apiKey, uuid, 'video', onProgress, timeoutMs);
}

export function getImageUrl(hist: SnapgenHistory): string | null {
  return extractMediaUrl(hist, 'image');
}

export async function downloadFile(url: string, destPath: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return destPath;
}
