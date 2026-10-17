import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey, useCurrentLocale, useErrorText, useMoneyFormat } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { FulfillmentType, WebPaymentOption } from '@pos/shared-types';
import type { CreateWebOrderRequest, PublicLocation, PublishedMenu } from '@pos/validation';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  Textarea,
  buttonVariants,
  cn,
} from '@pos/ui';
import { useMutation } from '@tanstack/react-query';
import { Bike, ShoppingBag } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { CartLines } from '../components/cart-lines';
import { OrderTotals } from '../components/order-totals';
import { OrderingNotice } from '../components/ordering-status';
import { storefront } from '../lib/api';
import { rememberPlacedOrder } from '../lib/placed-orders';
import { useLocation, useMenu } from '../lib/queries';
import { useCartQuote } from '../lib/quote';
import { useCart } from '../stores/cart';

const optionalText = (max: number) => z.string().trim().max(max, 'common:validation.tooLong');

export const checkoutSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'common:validation.required')
      .max(120, 'common:validation.tooLong'),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{5,20}$/, 'customer:checkout.invalidPhone'),
    email: z.union([z.literal(''), z.email('customer:checkout.invalidEmail')]),
    line1: optionalText(200),
    line2: optionalText(200),
    city: optionalText(100),
    addressNotes: optionalText(300),
    notes: optionalText(500),
    payment: z.enum(['PAY_AT_PICKUP', 'CASH_ON_DELIVERY', 'ONLINE_CARD']),
    testCard: z.enum(['tok_mock_visa', 'tok_mock_decline']),
    fulfillment: z.enum(['PICKUP', 'DELIVERY']),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillment === 'DELIVERY' && v.line1.length < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['line1'],
        message: 'customer:checkout.addressRequired',
      });
    }
  });
export type CheckoutValues = z.infer<typeof checkoutSchema>;

/** Pickup pays at the counter, delivery pays the driver; either may pay online instead. */
const handoverPayment = (f: FulfillmentType): WebPaymentOption =>
  f === 'PICKUP' ? 'PAY_AT_PICKUP' : 'CASH_ON_DELIVERY';

/** The request the website sends: choices only, never a price (the cloud prices the order). */
export function toWebOrder(
  orderId: string,
  locationId: string,
  lines: ReturnType<typeof useCart.getState>['lines'],
  v: CheckoutValues,
): CreateWebOrderRequest {
  return {
    id: orderId,
    locationId,
    fulfillment: v.fulfillment,
    deliveryAddress:
      v.fulfillment === 'DELIVERY'
        ? {
            line1: v.line1,
            line2: v.line2 || null,
            city: v.city || null,
            notes: v.addressNotes || null,
          }
        : null,
    customer: { name: v.name, phone: v.phone, email: v.email || null },
    items: lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      variantId: l.variantId,
      modifierIds: l.modifierIds,
      quantity: l.quantity,
      notes: l.notes,
    })),
    notes: v.notes || null,
    payment: {
      option: v.payment,
      cardToken: v.payment === 'ONLINE_CARD' ? v.testCard : null,
    },
  };
}

function CheckoutForm({ menu, location }: { menu: PublishedMenu; location: PublicLocation }) {
  const { t } = useTranslation(['customer', 'common', 'orders']);
  const locale = useCurrentLocale();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const { format } = useMoneyFormat(menu.currencyCode);
  const { lines, orderId, fulfillment, setFulfillment, clear } = useCart();
  const initialFulfillment: FulfillmentType =
    fulfillment === 'DELIVERY' && location.deliveryEnabled
      ? 'DELIVERY'
      : location.pickupEnabled
        ? 'PICKUP'
        : 'DELIVERY';
  const form = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      line1: '',
      line2: '',
      city: '',
      addressNotes: '',
      notes: '',
      fulfillment: initialFulfillment,
      payment: handoverPayment(initialFulfillment),
      testCard: 'tok_mock_visa',
    },
  });
  const chosen = form.watch('fulfillment');
  const payment = form.watch('payment');
  useEffect(() => {
    setFulfillment(chosen);
    if (form.getValues('payment') !== 'ONLINE_CARD')
      form.setValue('payment', handoverPayment(chosen));
  }, [chosen, form, setFulfillment]);
  const { quote, error } = useCartQuote(menu, lines, chosen, location.deliveryFee);

  const place = useMutation({
    mutationFn: (values: CheckoutValues) =>
      storefront.placeOrder(toWebOrder(orderId, location.id, lines, values)),
    onSuccess: (created) => {
      rememberPlacedOrder(created);
      clear();
      void navigate(`/confirmation/${encodeURIComponent(created.trackingToken)}`);
    },
  });

  const fieldError = (name: keyof CheckoutValues) => {
    const message = form.formState.errors[name]?.message;
    return message ? tKey(t, message) : undefined;
  };
  const open = location.status.state === 'OPEN';
  const choice = (value: FulfillmentType, enabled: boolean) =>
    cn(
      'flex flex-1 items-start gap-3 rounded-lg border-2 p-3 text-start',
      chosen === value ? 'border-primary bg-primary/10' : 'border-border bg-card',
      !enabled && 'opacity-50',
    );

  return (
    <form
      noValidate
      className="grid gap-4 lg:grid-cols-[1fr_22rem]"
      onSubmit={(event) => {
        void form.handleSubmit((values) => {
          place.mutate(values);
        })(event);
      }}
    >
      <div className="grid content-start gap-4">
        <h1 className="text-2xl font-semibold">{t('customer:checkout.title')}</h1>
        <OrderingNotice status={location.status} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('customer:checkout.contact')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label={t('customer:checkout.name')} error={fieldError('name')}>
              <Input autoComplete="name" {...form.register('name')} />
            </Field>
            <Field label={t('customer:checkout.phone')} error={fieldError('phone')}>
              <Input type="tel" dir="ltr" autoComplete="tel" {...form.register('phone')} />
            </Field>
            <Field
              label={t('customer:checkout.email')}
              error={fieldError('email')}
              className="sm:col-span-2"
            >
              <Input type="email" dir="ltr" autoComplete="email" {...form.register('email')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('customer:checkout.fulfillment')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div
              role="radiogroup"
              aria-label={t('customer:checkout.fulfillment')}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <label className={choice('PICKUP', location.pickupEnabled)}>
                <input
                  type="radio"
                  value="PICKUP"
                  disabled={!location.pickupEnabled}
                  className="mt-1"
                  {...form.register('fulfillment')}
                />
                <span className="grid gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    <ShoppingBag aria-hidden className="size-4" />
                    {t('customer:checkout.pickup')}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t('customer:checkout.pickupHint', {
                      location: pickLocalized(location, 'name', locale),
                    })}
                  </span>
                </span>
              </label>
              <label className={choice('DELIVERY', location.deliveryEnabled)}>
                <input
                  type="radio"
                  value="DELIVERY"
                  disabled={!location.deliveryEnabled}
                  className="mt-1"
                  {...form.register('fulfillment')}
                />
                <span className="grid gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    <Bike aria-hidden className="size-4" />
                    {t('customer:checkout.delivery')}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t('customer:checkout.deliveryHint')}
                  </span>
                </span>
              </label>
            </div>
            {chosen === 'DELIVERY' ? (
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-1 font-medium">{t('customer:checkout.address')}</legend>
                <Field
                  label={t('customer:checkout.line1')}
                  error={fieldError('line1')}
                  className="sm:col-span-2"
                >
                  <Input autoComplete="address-line1" {...form.register('line1')} />
                </Field>
                <Field label={t('customer:checkout.line2')} error={fieldError('line2')}>
                  <Input autoComplete="address-line2" {...form.register('line2')} />
                </Field>
                <Field label={t('customer:checkout.city')} error={fieldError('city')}>
                  <Input autoComplete="address-level2" {...form.register('city')} />
                </Field>
                <Field
                  label={t('customer:checkout.addressNotes')}
                  error={fieldError('addressNotes')}
                  className="sm:col-span-2"
                >
                  <Input {...form.register('addressNotes')} />
                </Field>
              </fieldset>
            ) : null}
            <Field label={t('customer:checkout.notes')} error={fieldError('notes')}>
              <Textarea rows={2} maxLength={500} {...form.register('notes')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('customer:checkout.payment')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div
              role="radiogroup"
              aria-label={t('customer:checkout.payment')}
              className="grid gap-2"
            >
              {(
                [
                  handoverPayment(chosen),
                  ...(location.onlineCardEnabled ? ['ONLINE_CARD' as const] : []),
                ] as WebPaymentOption[]
              ).map((option) => (
                <label
                  key={option}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border-2 p-3',
                    payment === option ? 'border-primary bg-primary/10' : 'border-border',
                  )}
                >
                  <input type="radio" value={option} {...form.register('payment')} />
                  <span className="font-medium">{t(`customer:checkout.${option}`)}</span>
                </label>
              ))}
            </div>
            {payment === 'ONLINE_CARD' ? (
              <div className="grid gap-2">
                <Field label={t('customer:checkout.testCard')}>
                  <NativeSelect {...form.register('testCard')}>
                    <option value="tok_mock_visa">{t('customer:checkout.testCardApproved')}</option>
                    <option value="tok_mock_decline">
                      {t('customer:checkout.testCardDeclined')}
                    </option>
                  </NativeSelect>
                </Field>
                <p className="text-xs text-muted-foreground">
                  {t('customer:checkout.testCardNote')}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <aside className="grid content-start gap-4 lg:sticky lg:top-20">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('customer:checkout.summary')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <CartLines menu={menu} quote={quote} editable={false} />
            {quote ? (
              <OrderTotals
                currency={menu.currencyCode}
                taxInclusive={menu.taxInclusive}
                totals={quote.pricing}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">{t('customer:cart.previewNote')}</p>
          </CardContent>
        </Card>
        {error ? (
          <Alert variant="destructive" title={t('customer:cart.unavailable')}>
            {tKey(t, `errors:${error.code}`)}
          </Alert>
        ) : null}
        {place.isError ? (
          <Alert variant="destructive" title={t('common:states.error')}>
            {errorText(place.error)}
          </Alert>
        ) : null}
        <Button type="submit" size="lg" disabled={!open || !quote || place.isPending}>
          {place.isPending
            ? t('customer:checkout.placing')
            : t('customer:checkout.place', { total: quote ? format(quote.pricing.total) : '' })}
        </Button>
        {!open ? (
          <p className="text-sm text-muted-foreground">{t('customer:checkout.closed')}</p>
        ) : null}
      </aside>
    </form>
  );
}

/** Guest checkout: contact, pickup or delivery, notes, payment, and the price preview. */
export function CheckoutPage() {
  const { t } = useTranslation(['customer']);
  const { locationId = '' } = useParams();
  const location = useLocation(locationId);
  const menu = useMenu(locationId);
  const { lines, ensureLocation } = useCart();
  useEffect(() => {
    ensureLocation(locationId);
  }, [ensureLocation, locationId]);

  if (lines.length === 0) {
    return (
      <EmptyState
        title={t('customer:cart.empty')}
        description={t('customer:cart.emptyHint')}
        action={
          <Link to={`/l/${locationId}`} className={buttonVariants()}>
            {t('customer:cart.browse')}
          </Link>
        }
      />
    );
  }
  return (
    <QueryState query={location}>
      {(loc) => (
        <QueryState query={menu}>{(m) => <CheckoutForm menu={m} location={loc} />}</QueryState>
      )}
    </QueryState>
  );
}
