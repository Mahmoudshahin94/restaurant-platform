import { useCurrentLocale, useErrorText } from '@pos/app-kit';
import { isApiError } from '@pos/api-client';
import { formatTime } from '@pos/i18n';
import { Alert, Button, EmptyState, Spinner } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { OrderStatusView } from '../components/order-status-view';
import { useTrackedOrder } from '../lib/queries';

/** The order-status page a tracking token opens; it refreshes itself while the order moves. */
export function TrackPage() {
  const { t } = useTranslation(['customer', 'common']);
  const locale = useCurrentLocale();
  const errorText = useErrorText();
  const { token = '' } = useParams();
  const order = useTrackedOrder(token);

  if (order.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner label={t('common:states.loading')} />
      </div>
    );
  }
  if (order.isError && !order.data) {
    return isApiError(order.error) && order.error.status === 404 ? (
      <EmptyState
        title={t('customer:status.notFound')}
        description={t('customer:status.notFoundHint')}
      />
    ) : (
      <Alert
        variant="destructive"
        title={t('common:states.error')}
        action={
          <Button variant="outline" size="sm" onClick={() => void order.refetch()}>
            {t('common:actions.retry')}
          </Button>
        }
      >
        {errorText(order.error)}
      </Alert>
    );
  }
  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-3">
      <OrderStatusView order={order.data} />
      <p className="text-center text-xs text-muted-foreground">
        {t('customer:status.liveUpdates')}{' '}
        {t('customer:status.updatedAt', {
          time: formatTime(
            new Date(order.dataUpdatedAt).toISOString(),
            order.data.location.timezone,
            locale,
          ),
        })}
      </p>
    </div>
  );
}
