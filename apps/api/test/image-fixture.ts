/** Tiny images for the branding and file tests (ADR 0019). */

/** A real 1×1 PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQTX4NAAIkAXSaGkHUAAAAAElFTkSuQmCC',
  'base64',
);

/** The start of a JPEG (signature and a JFIF segment): enough for the type check. */
export const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
]);

/** An icon directory holding one 16×16 PNG. */
export const ICO = Buffer.concat([
  Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]),
  Buffer.from([PNG.length & 0xff, PNG.length >> 8, 0, 0, 22, 0, 0, 0]),
  PNG,
]);

/** An SVG carrying script: never accepted, whatever it is called. */
export const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
);
