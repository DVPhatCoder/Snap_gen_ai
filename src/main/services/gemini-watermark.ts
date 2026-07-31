import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ImageDataLike } from '@pilio/gemini-watermark-remover';
import type { NodeCodecContext } from '@pilio/gemini-watermark-remover/node';

async function decodeImageData(
  input: Buffer | Uint8Array | ArrayBuffer,
  _context: NodeCodecContext
): Promise<ImageDataLike> {
  const buf = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
      ? Buffer.from(input)
      : Buffer.from(input);
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  };
}

async function encodeImageData(
  imageData: ImageDataLike,
  context: NodeCodecContext
): Promise<Buffer> {
  const pipeline = sharp(Buffer.from(imageData.data), {
    raw: {
      width: imageData.width,
      height: imageData.height,
      channels: 4,
    },
  });

  const mime = (context.mimeType || '').toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  }
  if (mime === 'image/webp') {
    return pipeline.webp({ quality: 95 }).toBuffer();
  }
  return pipeline.png().toBuffer();
}

/**
 * Package chỉ khai báo exports ESM (`import`), không có `require`.
 * Electron main (CJS) phải dynamic-import — static require sẽ crash lúc boot.
 */
async function loadGwrNode() {
  return import('@pilio/gemini-watermark-remover/node');
}

/**
 * Xóa watermark Gemini / nano-banana bằng Reverse Alpha Blending
 * (@pilio/gemini-watermark-remover) — chính xác hơn FFmpeg delogo.
 * Trả về true nếu engine báo đã apply.
 */
export async function removeGeminiWatermarkFromFile(imagePath: string): Promise<boolean> {
  if (!fs.existsSync(imagePath)) return false;

  const { inferMimeTypeFromPath, removeWatermarkFromFile } = await loadGwrNode();

  const ext = path.extname(imagePath) || '.png';
  const tmp = path.join(
    path.dirname(imagePath),
    `.gwr-${process.pid}-${Date.now()}${ext}`
  );

  try {
    const result = await removeWatermarkFromFile(imagePath, {
      outputPath: tmp,
      mimeType: inferMimeTypeFromPath(imagePath),
      adaptiveMode: 'auto',
      aggressiveLocatedFallback: true,
      locatedAggressiveRemoval: true,
      decodeImageData,
      encodeImageData,
    });

    if (!result.meta.applied) {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      return false;
    }

    fs.renameSync(tmp, imagePath);
    return true;
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
