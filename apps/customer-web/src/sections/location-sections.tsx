import { useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { WebsiteSectionType } from '@pos/shared-types';
import { Card, CardContent, CardHeader, CardTitle, buttonVariants } from '@pos/ui';
import type { PublicLocation, WebsiteSectionOf } from '@pos/validation';
import { Bike, MapPin, Phone, ShoppingBag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { OpeningHours } from '../components/opening-hours';
import { OrderingBadge } from '../components/ordering-status';
import { SectionFrame, useLocalizedText, useSiteContext } from './section-kit';

type Props<T extends WebsiteSectionType> = { section: WebsiteSectionOf<T> };

/** One branch: whether it takes orders, how, its hours, and the way to its menu. */
export function LocationCard({ location }: { location: PublicLocation }) {
  const { t } = useTranslation('customer');
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(location.currencyCode);
  const name = pickLocalized(location, 'name', locale);
  return (
    <Card className="text-start">
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

export function LocationsSection({ section }: Props<'LOCATIONS'>) {
  const { t } = useTranslation('customer');
  const text = useLocalizedText();
  const { locations } = useSiteContext();
  return (
    <SectionFrame section={section} title={text(section.content.title)}>
      {locations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">{t('landing.noLocations')}</p>
          <p className="text-sm text-muted-foreground">{t('landing.noLocationsHint')}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {locations.map((location) => (
            <LocationCard key={location.id} location={location} />
          ))}
        </div>
      )}
    </SectionFrame>
  );
}

/** The opening hours of one branch, or of each. */
export function OpeningHoursSection({ section }: Props<'OPENING_HOURS'>) {
  const text = useLocalizedText();
  const locale = useCurrentLocale();
  const { locations } = useSiteContext();
  const shown = section.content.locationId
    ? locations.filter((l) => l.id === section.content.locationId)
    : locations;
  if (shown.length === 0) return null;
  return (
    <SectionFrame section={section} title={text(section.content.title)}>
      <div className="grid gap-6 text-start sm:grid-cols-2">
        {shown.map((location) => (
          <div key={location.id} className="grid gap-2">
            {shown.length > 1 ? (
              <h3 className="font-semibold">{pickLocalized(location, 'name', locale)}</h3>
            ) : null}
            <OpeningHours windows={location.openingHours} />
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}
