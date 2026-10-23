import type { BrandingImageType } from '@pos/shared-types';

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * The image type the bytes really are, from their signature: PNG, JPEG, WebP or ICO. Anything
 * else (SVG, HTML, GIF, a renamed file) is null. The declared content type is never trusted.
 */
export function sniffImageType(bytes: Uint8Array): BrandingImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  // ICONDIR: reserved 0, type 1 (icon), at least one image.
  if (bytes.length >= 6 && startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) && (bytes[4]! | bytes[5]!) > 0) {
    return 'image/x-icon';
  }
  return null;
}

/** The declared type in its canonical spelling (`image/vnd.microsoft.icon` is an ICO too). */
export function canonicalImageType(contentType: string | undefined): string {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  return type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : type;
}
