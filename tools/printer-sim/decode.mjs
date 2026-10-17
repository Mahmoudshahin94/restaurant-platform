/**
 * Decodes the raster parts of an ESC/POS job (GS v 0 bands) into one 1-bit image.
 * Returns null when the job has no raster data.
 */
export function decodeRasterJob(bytes) {
  const bands = [];
  let cut = false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) {
      const bytesPerRow = bytes[i + 4] | (bytes[i + 5] << 8);
      const rows = bytes[i + 6] | (bytes[i + 7] << 8);
      const start = i + 8;
      bands.push({ bytesPerRow, data: bytes.subarray(start, start + bytesPerRow * rows) });
      i = start + bytesPerRow * rows - 1;
    } else if (bytes[i] === 0x1d && bytes[i + 1] === 0x56) {
      cut = true;
    }
  }
  if (bands.length === 0) return null;
  const bytesPerRow = bands[0].bytesPerRow;
  const data = Buffer.concat(bands.map((b) => Buffer.from(b.data)));
  return { width: bytesPerRow * 8, height: data.length / bytesPerRow, data, cut };
}
