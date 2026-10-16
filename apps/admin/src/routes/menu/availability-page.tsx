import { pickLocalized } from '@pos/i18n';
import type { LocationProductSetting, Product } from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryState } from '../../components/query-state';
import { api } from '../../lib/api';
import { tKey, useErrorText } from '../../lib/errors';
import { useCurrentLocale } from '../../lib/locale';
import { optionalMoneyField, useMoney } from '../../lib/money';
import { usePermissions } from '../../lib/permissions';
import {
  useCatalogMutation,
  useLocations,
  useProductSettings,
  useProducts,
} from '../../lib/queries';
import { usePreferences } from '../../stores/preferences';

interface RowProps {
  product: Product;
  setting: LocationProductSetting | undefined;
  locationId: string;
  currency: string;
  editable: boolean;
}

function AvailabilityRow({ product, setting, locationId, currency, editable }: RowProps) {
  const { t } = useTranslation(['menu', 'common']);
  const locale = useCurrentLocale();
  const errorText = useErrorText();
  const { format, toInput } = useMoney();
  const hasVariants = product.variants.length > 0;
  const [available, setAvailable] = useState(setting?.isAvailable ?? true);
  const [override, setOverride] = useState(toInput(setting?.priceOverride ?? null));
  const [error, setError] = useState<string | null>(null);
  const save = useCatalogMutation((body: { isAvailable: boolean; priceOverride: number | null }) =>
    api.locations.setProductSettings(locationId, product.id, body),
  );
  const dirty =
    available !== (setting?.isAvailable ?? true) ||
    override !== toInput(setting?.priceOverride ?? null);
  const name = pickLocalized(product, 'name', locale);

  const submit = async () => {
    setError(null);
    const parsed = optionalMoneyField(currency).safeParse(override);
    if (!parsed.success) {
      setError(tKey(t, parsed.error.issues[0]?.message ?? 'common:validation.invalid'));
      return;
    }
    try {
      await save.mutateAsync({
        isAvailable: available,
        priceOverride: hasVariants ? null : parsed.data,
      });
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell className="ltr-nums">{format(product.price)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Switch
            aria-label={t('menu:availability.available')}
            checked={available}
            disabled={!editable}
            onCheckedChange={setAvailable}
          />
          <Badge variant={available ? 'success' : 'destructive'}>
            {available ? t('menu:availability.available') : t('menu:availability.soldOut')}
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        {hasVariants ? (
          <span className="text-xs text-muted-foreground">
            {t('menu:availability.variantsNoOverride')}
          </span>
        ) : (
          <Input
            aria-label={t('menu:availability.priceOverride')}
            inputMode="decimal"
            dir="ltr"
            className="w-32"
            placeholder={t('menu:availability.priceOverrideHint')}
            disabled={!editable}
            value={override}
            onChange={(e) => {
              setOverride(e.target.value);
            }}
          />
        )}
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </TableCell>
      <TableCell className="text-end">
        {editable ? (
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => void submit()}>
            {save.isPending ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export function AvailabilityPage() {
  const { t } = useTranslation(['menu', 'common']);
  const locale = useCurrentLocale();
  const { canAt } = usePermissions();
  const { currency } = useMoney();
  const locationId = usePreferences((s) => s.locationId);
  const locations = useLocations();
  const products = useProducts({});
  const settings = useProductSettings(locationId);
  const location = locations.data?.find((l) => l.id === locationId);

  if (!locationId || !location) {
    return (
      <>
        <PageHeader
          title={t('menu:availability.title')}
          description={t('menu:availability.description')}
        />
        <EmptyState title={t('menu:availability.noLocation')} />
      </>
    );
  }
  const editable = canAt(locationId, 'products.update');

  return (
    <>
      <PageHeader
        title={t('menu:availability.title')}
        description={`${t('menu:availability.description')} · ${pickLocalized(location, 'name', locale)}`}
      />
      {settings.isError ? <Alert variant="destructive">{t('common:states.error')}</Alert> : null}
      <QueryState
        query={products}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('menu:products.empty') }}
      >
        {(rows) =>
          currency && settings.data ? (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('menu:fields.name')}</TableHead>
                    <TableHead className="w-32">{t('menu:products.price')}</TableHead>
                    <TableHead className="w-56">{t('menu:fields.status')}</TableHead>
                    <TableHead className="w-48">{t('menu:availability.priceOverride')}</TableHead>
                    <TableHead className="w-28 text-end">{t('menu:fields.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((product) => {
                    const setting = settings.data.find((s) => s.productId === product.id);
                    return (
                      <AvailabilityRow
                        key={`${locationId}:${product.id}:${setting?.updatedAt ?? 'default'}`}
                        product={product}
                        setting={setting}
                        locationId={locationId}
                        currency={currency}
                        editable={editable}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          ) : null
        }
      </QueryState>
    </>
  );
}
