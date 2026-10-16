import { Alert, Button, EmptyState, Spinner } from '@pos/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorText } from '../lib/errors';

interface QueryStateProps<T> {
  query: UseQueryResult<T>;
  isEmpty?: (data: T) => boolean;
  empty?: { title: string; description?: string; action?: ReactNode };
  children: (data: T) => ReactNode;
}

/** Renders loading, error (with retry), empty and success states consistently. */
export function QueryState<T>({ query, isEmpty, empty, children }: QueryStateProps<T>) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  if (query.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner label={t('states.loading')} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Alert
        variant="destructive"
        title={t('states.error')}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('actions.retry')}
          </Button>
        }
      >
        {errorText(query.error)}
      </Alert>
    );
  }
  if (empty && isEmpty?.(query.data)) {
    return <EmptyState title={empty.title} description={empty.description} action={empty.action} />;
  }
  return <>{children(query.data)}</>;
}
