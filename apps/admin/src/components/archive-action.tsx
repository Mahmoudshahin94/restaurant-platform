import { Archive, ArchiveRestore } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ArchiveActionProps {
  name: string;
  archived: boolean;
  canArchive: boolean;
  canRestore: boolean;
  pending: boolean;
  onArchive: () => Promise<unknown>;
  onRestore: () => Promise<unknown>;
}

/** Archive (with confirmation) or restore a catalog row. Nothing is ever hard-deleted. */
export function ArchiveAction({
  name,
  archived,
  canArchive,
  canRestore,
  pending,
  onArchive,
  onRestore,
}: ArchiveActionProps) {
  const { t } = useTranslation(['menu', 'common']);
  const [open, setOpen] = useState(false);

  if (archived) {
    return canRestore ? (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => void onRestore()}>
        <ArchiveRestore aria-hidden />
        {t('common:actions.restore')}
      </Button>
    ) : null;
  }
  if (!canArchive) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Archive aria-hidden />
        {t('common:actions.archive')}
      </Button>
      <DialogContent closeLabel={t('common:actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('menu:archiveConfirm.title', { name })}</DialogTitle>
          <DialogDescription>{t('menu:archiveConfirm.body')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('common:actions.cancel')}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              void onArchive().then(() => {
                setOpen(false);
              });
            }}
          >
            {t('common:actions.archive')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
