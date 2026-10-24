import type { TenantFileKind } from '@pos/shared-types';

/** What the file picker offers for each kind of tenant file (the server checks the bytes). */
export const ACCEPT: Record<TenantFileKind, string> = {
  LOGO: 'image/png,image/jpeg,image/webp',
  FAVICON: 'image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico',
  PRODUCT_IMAGE: 'image/png,image/jpeg,image/webp',
  WEBSITE_IMAGE: 'image/png,image/jpeg,image/webp',
};
