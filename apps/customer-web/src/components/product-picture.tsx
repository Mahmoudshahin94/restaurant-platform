import { cn } from '@pos/ui';
import { useState } from 'react';
import { storefront } from '../lib/api';

/**
 * A product picture of the site's business (ADR 0027), served by the site's own host. Decorative:
 * the product's name is always written next to it. A picture that cannot load disappears.
 */
export function ProductPicture({
  fileId,
  className,
}: {
  fileId: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!fileId || failed === fileId) return null;
  return (
    <img
      src={storefront.fileUrl(fileId)}
      alt=""
      loading="lazy"
      className={cn('object-cover', className)}
      onError={() => {
        setFailed(fileId);
      }}
    />
  );
}
