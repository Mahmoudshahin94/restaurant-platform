/**
 * ESC/POS encoding for receipt printers. Receipts are sent as a raster image (GS v 0), which
 * every mainstream ESC/POS thermal printer supports, so Arabic shaping and RTL layout are
 * identical on all printers and no code-page support is needed.
 */

/** 1 bit per pixel, rows packed MSB-first, `width` a multiple of 8. 1 = black. */
export interface MonoBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

const ESC = 0x1b;
const GS = 0x1d;

/** Max rows per GS v 0 command; large images are split to fit printer buffers. */
const BAND_HEIGHT = 256;

/**
 * Converts RGBA pixels (e.g. canvas ImageData) to a mono bitmap. A pixel is black when its
 * luminance is below `threshold` and it is not transparent. Width is padded to a multiple of 8.
 */
export function rgbaToMonoBitmap(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 160,
): MonoBitmap {
  const paddedWidth = Math.ceil(width / 8) * 8;
  const bytesPerRow = paddedWidth / 8;
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = rgba[i] ?? 255;
      const g = rgba[i + 1] ?? 255;
      const b = rgba[i + 2] ?? 255;
      const a = rgba[i + 3] ?? 0;
      const luminance = (r * 299 + g * 587 + b * 114) / 1000;
      if (a > 127 && luminance < threshold) {
        const byteIndex = y * bytesPerRow + Math.floor(x / 8);
        data[byteIndex] = (data[byteIndex] ?? 0) | (0x80 >> (x % 8));
      }
    }
  }
  return { width: paddedWidth, height, data };
}

/** Encodes a full print job: initialize, raster image in bands, feed and partial cut. */
export function encodeRasterJob(
  bitmap: MonoBitmap,
  options: { feedLines?: number; cut?: boolean } = {},
): Uint8Array {
  if (bitmap.width % 8 !== 0) throw new Error('Bitmap width must be a multiple of 8');
  const bytesPerRow = bitmap.width / 8;
  if (bitmap.data.length !== bytesPerRow * bitmap.height)
    throw new Error('Bitmap data size mismatch');

  const parts: number[][] = [[ESC, 0x40]]; // ESC @ initialize
  for (let top = 0; top < bitmap.height; top += BAND_HEIGHT) {
    const rows = Math.min(BAND_HEIGHT, bitmap.height - top);
    // GS v 0 m xL xH yL yH d1…dk (m = 0: normal density)
    parts.push([
      GS,
      0x76,
      0x30,
      0x00,
      bytesPerRow & 0xff,
      (bytesPerRow >> 8) & 0xff,
      rows & 0xff,
      (rows >> 8) & 0xff,
    ]);
    parts.push(Array.from(bitmap.data.subarray(top * bytesPerRow, (top + rows) * bytesPerRow)));
  }
  parts.push([ESC, 0x64, options.feedLines ?? 4]); // ESC d n: feed n lines
  if (options.cut ?? true) parts.push([GS, 0x56, 0x42, 0x00]); // GS V B 0: feed and partial cut

  const length = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Common print widths in dots at 203 dpi. */
export const PAPER_WIDTH_DOTS = { '58mm': 384, '80mm': 576 } as const;
export type PaperWidth = keyof typeof PAPER_WIDTH_DOTS;
