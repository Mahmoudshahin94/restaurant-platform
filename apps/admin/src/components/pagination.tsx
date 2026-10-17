import { Button } from '@pos/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}

/** Previous / next with "Page x of y". Chevrons flip in RTL. */
export function Pagination({ page, pageSize, total, onPage }: PaginationProps) {
  const { t } = useTranslation('admin');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      aria-label={t('shared.pagination')}
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span className="text-muted-foreground">
        {t('shared.total', { count: total })} ·{' '}
        <span className="ltr-nums">{t('shared.pageOf', { page, pages })}</span>
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => {
            onPage(page - 1);
          }}
        >
          <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
          {t('shared.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => {
            onPage(page + 1);
          }}
        >
          {t('shared.next')}
          <ChevronRight aria-hidden className="rtl:-scale-x-100" />
        </Button>
      </div>
    </nav>
  );
}
