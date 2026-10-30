import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { useTenantId } from './queries';

/** An uploaded file, downloaded with the admin's session, as an object URL. */
export function useTenantFileUrl(fileId: string | null): string | null {
  const tid = useTenantId();
  const blob = useQuery({
    queryKey: ['tenant-file', tid, fileId],
    queryFn: () => api.files.content(tid, fileId ?? ''),
    enabled: fileId !== null,
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!fileId || !blob.data) {
      setUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(blob.data);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, blob.data]);
  return url;
}

/**
 * A picture made smaller before it is uploaded: at most `maxSide` pixels on its longest side,
 * re-encoded as WebP (JPEG where the browser cannot). Menus show pictures small, so the hubs and
 * screens fetch a fraction of a camera photo. The original is kept when it is already small, or
 * when this browser cannot decode or encode it.
 */
export async function shrinkImage(file: File, maxSide = 1200): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, 0.85);
    });
  const webp = await encode('image/webp');
  const smaller = webp?.type === 'image/webp' ? webp : await encode('image/jpeg');
  return smaller && smaller.size < file.size ? smaller : file;
}
