type ValueOf<T> = T[keyof T];

/**
 * How a barcode is encoded (ADR 0021). EAN and UPC codes carry a check digit, verified when the
 * code is saved; CODE128 and OTHER are taken as printed. Stored as text.
 */
export const BarcodeSymbology = {
  EAN13: 'EAN13',
  EAN8: 'EAN8',
  UPC_A: 'UPC_A',
  CODE128: 'CODE128',
  OTHER: 'OTHER',
} as const;
export type BarcodeSymbology = ValueOf<typeof BarcodeSymbology>;
export const BARCODE_SYMBOLOGIES = Object.values(BarcodeSymbology) as readonly BarcodeSymbology[];

/** Longest barcode accepted, in characters (printable ASCII without spaces). */
export const BARCODE_MAX_LENGTH = 64;
