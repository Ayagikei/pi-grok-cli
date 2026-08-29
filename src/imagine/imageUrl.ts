import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const MIME_BY_EXT = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

export function detectImageMime(bytes: Uint8Array, filePath = '') {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)
    return 'image/webp';
  return MIME_BY_EXT.get(extname(filePath).toLowerCase());
}

export function imageFileToDataUri(filePath: string) {
  const bytes = readFileSync(filePath);
  const mime = detectImageMime(bytes, filePath);
  if (!mime) throw new Error(`Unsupported image file: ${filePath}`);
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}
