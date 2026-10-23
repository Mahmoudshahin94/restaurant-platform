import { QueryState, useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { PublicLocation } from '@pos/validation';
import { Card, CardContent, CardHeader, CardTitle, PageHeader, buttonVariants } from '@pos/ui';
import { Bike, MapPin, Phone, ShoppingBag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { OpeningHours } from '../components/opening-hours';
import { OrderingBadge } from '../components/ordering-status';
import { useTenant } from '../lib/queries';

function LocationCard({ location }: { location: PublicLocation }) {
  const { t } = useTranslation('customer');
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(location.currencyCode);
  const name = pickLocalized(location, 'name', locale);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <CardTitle>{name}</CardTitle>
        <OrderingBadge status={location.status} />
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1 text-sm text-muted-foreground">
          {location.addressLine ? (
            <p className="flex items-center gap-2">
              <MapPin aria-hidden className="size-4" />
              {location.addressLine}
            </p>
          ) : null}
          {location.phone ? (
            <p className="flex items-center gap-2">
              <Phone aria-hidden className="size-4" />
              <bdi className="ltr-nums">{location.phone}</bdi>
            </p>
          ) : null}
          <p className="flex flex-wrap items-center gap-3">
            {location.pickupEnabled ? (
              <span className="flex items-center gap-1">
                <ShoppingBag aria-hidden className="size-4" />
                {t('landing.pickup')}
              </span>
            ) : null}
            {location.deliveryEnabled ? (
              <span className="flex items-center gap-1">
                <Bike aria-hidden className="size-4" />
                {t('landing.delivery')}
                {location.deliveryFee > 0 ? (
                  <span> · {t('landing.deliveryFee', { fee: format(location.deliveryFee) })}</span>
                ) : null}
              </span>
            ) : null}
          </p>
        </div>
        <div className="grid gap-1">
          <p className="text-sm font-medium">{t('ordering.hours')}</p>
          <OpeningHours windows={location.openingHours} />
        </div>
        <Link
          to={`/l/${location.id}`}
          className={buttonVariants({ size: 'lg' })}
          aria-label={`${t('landing.viewMenu')} · ${name}`}
        >
          {t('landing.viewMenu')}
        </Link>
      </CardContent>
    </Card>
  );
}

/** The tenant's branches, each with whether it takes orders and how. */
export function LandingPage() {
  const { t } = useTranslation('customer');
  const locale = useCurrentLocale();
  const tenant = useTenant();
  return (
    <QueryState
      query={tenant}
      isEmpty={(r) => r.locations.length === 0}
      empty={{ title: t('landing.noLocations'), description: t('landing.noLocationsHint') }}
    >
      {(r) => (
        <>
          <PageHeader
            title={t('landing.title', { name: pickLocalized(r, 'name', locale) })}
            description={t('landing.subtitle')}
          />
          <div className="grid gap-4 md:grid-cols-2">
            {r.locations.map((location) => (
              <LocationCard key={location.id} location={location} />
            ))}
          </div>
        </>
      )}
    </QueryState>
  );
}
