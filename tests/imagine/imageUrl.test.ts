import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectImageMime, imageFileToDataUri } from '../../src/imagine/imageUrl.js';

describe('imageFileToDataUri', () => {
  it('detects PNG JPEG GIF and WEBP magic bytes', () => {
    expect(detectImageMime(Uint8Array.of(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
    expect(detectImageMime(Uint8Array.of(0xff, 0xd8, 0xff))).toBe('image/jpeg');
    expect(detectImageMime(Uint8Array.of(0x47, 0x49, 0x46, 0x38))).toBe('image/gif');
    expect(detectImageMime(Uint8Array.of(0x52, 0x49, 0x46, 0x46))).toBe('image/webp');
    expect(detectImageMime(Uint8Array.of(0x00), 'shot.webp')).toBe('image/webp');
  });

  it('encodes a PNG file as a data URI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-grok-cli-image-'));
    const filePath = join(dir, 'shot.png');
    writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    expect(imageFileToDataUri(filePath)).toBe(
      `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64')}`,
    );
  });
});
