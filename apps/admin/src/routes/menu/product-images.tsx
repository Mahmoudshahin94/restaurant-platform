import { useErrorText } from '@pos/app-kit';
import { TENANT_FILE_MAX_BYTES } from '@pos/shared-types';
import { Badge, Button } from '@pos/ui';
import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useTenantId } from '../../lib/queries';
import { shrinkImage, useTenantFileUrl } from '../../lib/tenant-files';

/** A product's pictures, as many as the API accepts (ADR 0027). */
export const MAX_PRODUCT_IMAGES = 10;
const ACCEPT = 'image/png,image/jpeg,image/webp';

/**
 * The pictures of a product, in order: the first is its cover on the POS, the kiosk and the
 * website. Pictures are made smaller in the browser, uploaded at once, and attached when the
 * product is saved; removing one only detaches it.
 */
export function ProductImagesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (fileIds: string[]) => void;
}) {
  const { t } = useTranslation(['menu']);
  const tid = useTenantId();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = value.length >= MAX_PRODUCT_IMAGES;

  const add = async (files: File[]) => {
    setError(null);
    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of files.slice(0, MAX_PRODUCT_IMAGES - value.length)) {
        const blob = await shrinkImage(file);
        if (blob.size > TENANT_FILE_MAX_BYTES.PRODUCT_IMAGE) {
          setError(t('menu:images.tooLarge', { name: file.name }));
          continue;
        }
        const created = await api.menu.products.uploadImage(tid, blob);
        added.push(created.id);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      if (added.length > 0) onChange([...value, ...added]);
      setBusy(false);
    }
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(index + by, 0, item);
    onChange(next);
  };

  return (
    <fieldset className="grid content-start gap-2">
      <legend className="text-sm font-medium">{t('menu:images.title')}</legend>
      <p className="text-xs text-muted-foreground">{t('menu:images.hint')}</p>
      <ul className="flex flex-wrap gap-3" aria-label={t('menu:images.title')}>
        {value.map((fileId, index) => (
          <li key={fileId} className="grid w-28 gap-1">
            <Thumbnail
              fileId={fileId}
              alt={t('menu:images.alt', { position: index + 1 })}
              cover={index === 0}
            />
            <div className="flex justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('menu:images.moveEarlier')}
                disabled={index === 0}
                onClick={() => {
                  move(index, -1);
                }}
              >
                <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('menu:images.moveLater')}
                disabled={index === value.length - 1}
                onClick={() => {
                  move(index, 1);
                }}
              >
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('menu:images.remove')}
                onClick={() => {
                  onChange(value.filter((id) => id !== fileId));
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </li>
        ))}
        {full ? null : (
          <li>
            <label className="flex size-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 text-center text-xs text-muted-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
              <ImagePlus className="size-5" aria-hidden />
              {busy ? t('menu:images.uploading') : t('menu:images.add')}
              <input
                type="file"
                className="sr-only"
                accept={ACCEPT}
                multiple
                disabled={busy}
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  if (files.length > 0) void add(files);
                }}
              />
            </label>
          </li>
        )}
      </ul>
      {full ? (
        <p className="text-xs text-muted-foreground">
          {t('menu:images.limit', { count: MAX_PRODUCT_IMAGES })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function Thumbnail({ fileId, alt, cover }: { fileId: string; alt: string; cover: boolean }) {
  const { t } = useTranslation(['menu']);
  const url = useTenantFileUrl(fileId);
  return (
    <div className="relative size-28 overflow-hidden rounded-md border bg-muted">
      {url ? <img src={url} alt={alt} className="size-full object-cover" /> : null}
      {cover ? (
        <Badge className="absolute start-1 top-1" variant="secondary">
          {t('menu:images.cover')}
        </Badge>
      ) : null}
    </div>
  );
}
