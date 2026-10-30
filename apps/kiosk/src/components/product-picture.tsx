import { cn } from '@pos/ui';
import { useState } from 'react';
import { api } from '../lib/api';

/**
 * A product picture served by the location hub (ADR 0027). Decorative: the product's name is
 * always written next to it. One the hub has not fetched yet simply disappears.
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
      src={api.mediaUrl(fileId)}
      alt=""
      draggable={false}
      className={cn('object-cover', className)}
      onError={() => {
        setFailed(fileId);
      }}
    />
  );
}
