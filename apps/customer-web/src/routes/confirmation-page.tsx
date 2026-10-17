import { useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { Button, Card, CardContent, CardHeader, CardTitle, Spinner, buttonVariants } from '@pos/ui';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { placedOrder } from '../lib/placed-orders';
import { useTrackedOrder } from '../lib/queries';
import { TrackPage } from './track-page';

/** "Thank you": the order number, where it went, and the tracking link to keep. */
export function ConfirmationPage() {
  const { t } = useTranslation(['customer', 'common']);
  const locale = useCurrentLocale();
  const { token = '' } = useParams();
  const remembered = placedOrder(token);
  const tracked = useTrackedOrder(token);
  const order = tracked.data ?? remembered?.order;
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/track/${encodeURIComponent(token)}`;

  if (!order) {
    return tracked.isPending ? (
      <div className="flex justify-center py-12">
        <Spinner label={t('common:states.loading')} />
      </div>
    ) : (
      <TrackPage />
    );
  }
  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-4">
      <Card className="min-w-0">
        <CardHeader className="items-center gap-2 text-center">
          <CircleCheck aria-hidden className="size-12 text-success" />
          <CardTitle className="text-2xl">
            {t('customer:confirmation.title', { name: order.customerName })}
          </CardTitle>
          <p>
            {t('customer:confirmation.received', {
              number: order.orderNumber,
              location: pickLocalized(order.location, 'name', locale),
            })}
          </p>
          <p className="text-muted-foreground">{t('customer:confirmation.waiting')}</p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Link
            to={`/track/${encodeURIComponent(token)}`}
            className={buttonVariants({ size: 'lg' })}
          >
            {t('customer:confirmation.track')}
          </Link>
          <div className="grid gap-1 text-sm">
            <p className="text-muted-foreground">{t('customer:confirmation.keepLink')}</p>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs"
              >
                {link}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => {
                      setCopied(true);
                    })
                    .catch(() => undefined);
                }}
              >
                {copied ? t('customer:confirmation.copied') : t('customer:confirmation.copy')}
              </Button>
            </div>
          </div>
          <Link to={`/l/${order.locationId}`} className={buttonVariants({ variant: 'outline' })}>
            {t('customer:confirmation.newOrder')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
