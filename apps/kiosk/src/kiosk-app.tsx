import { isApiError } from '@pos/api-client';
import {
  type BrandingFileSource,
  QueryState,
  type ScanEvent,
  TenantContextProvider,
  useBarcodeScanner,
  useCurrentLocale,
  useFeature,
  useLocaleSelection,
} from '@pos/app-kit';
import { lookupCode } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import { Feature } from '@pos/shared-types';
import type {
  KioskAttendant,
  KioskContext,
  Order,
  PublishedMenu,
  PublishedMenuProduct,
} from '@pos/validation';
import { Dialog, Spinner } from '@pos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Announcer, useAnnounce } from './components/announcer';
import { AttendantMenu, AttendantPinDialog } from './components/attendant';
import { BarcodeDialog } from './components/barcode-dialog';
import { CartPanel, lineName } from './components/cart-panel';
import { CheckoutScreen } from './components/checkout-screen';
import { DoneScreen } from './components/done-screen';
import { IdleOverlay } from './components/idle-overlay';
import { KioskHeader } from './components/kiosk-header';
import { MenuScreen } from './components/menu-screen';
import { type OptionsChoice, OptionsDialog } from './components/options-dialog';
import { PairScreen } from './components/pair-screen';
import { PayingScreen } from './components/paying-screen';
import { UnavailableScreen } from './components/unavailable-screen';
import { WelcomeScreen } from './components/welcome-screen';
import { KIOSK_VERSION, api } from './lib/api';
import { useIdleReset } from './lib/idle';
import { useCartQuote } from './lib/quote';
import { useDevice } from './stores/device';
import { useSession } from './stores/session';

/** How often the kiosk picks up menu and module changes synced to its hub. */
const REFRESH_MS = 60_000;

const hubFiles: BrandingFileSource = (fileId) => api.brandingFileUrl(fileId);

type Overlay =
  | { kind: 'none' }
  | {
      kind: 'options';
      product: PublishedMenuProduct;
      variantId: string | null;
      barcode: string | null;
    }
  | { kind: 'barcode' }
  | { kind: 'pin' }
  | { kind: 'attendant'; attendant: KioskAttendant };

/**
 * The self-service kiosk (ADR 0022). Unpaired, it asks for its pairing code; paired, it shows the
 * tenant's kiosk in the tenant's look and languages, as long as SELF_CHECKOUT is on for its
 * location and itself. It talks to its location hub only, so it keeps working without the
 * internet.
 */
export function KioskApp() {
  const credential = useDevice((s) => s.credential);
  return <Announcer>{credential ? <PairedKiosk /> : <PairScreen />}</Announcer>;
}

function PairedKiosk() {
  const forget = useDevice((s) => s.forget);
  const context = useQuery({
    queryKey: ['kiosk-context'],
    queryFn: () => api.context(),
    refetchInterval: REFRESH_MS,
    retry: (count, error) => !(isApiError(error) && error.status === 401) && count < 2,
  });
  // The hub no longer knows this kiosk (an administrator disabled it): pair it again.
  useEffect(() => {
    if (isApiError(context.error) && context.error.status === 401) forget();
  }, [context.error, forget]);
  return (
    <QueryState query={context}>
      {(kiosk) => (
        <TenantContextProvider value={kiosk.context} files={hubFiles}>
          <KioskFlow kiosk={kiosk} />
        </TenantContextProvider>
      )}
    </QueryState>
  );
}

function KioskFlow({ kiosk }: { kiosk: KioskContext }) {
  const { t } = useTranslation('kiosk');
  const locale = useCurrentLocale();
  const announce = useAnnounce();
  const queryClient = useQueryClient();
  const forget = useDevice((s) => s.forget);
  const session = useSession();
  const selfCheckout = useFeature(Feature.SELF_CHECKOUT);
  const barcodes = useFeature(Feature.BARCODE);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const locationId = kiosk.location.id;

  // Each customer starts in the tenant's language unless they choose another (ADR 0020).
  useLocaleSelection(kiosk.context.locales, { stored: session.locale });
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-large-text', session.largeText);
  }, [session.largeText]);

  const menu = useQuery({
    queryKey: ['kiosk-menu', locationId],
    queryFn: () => api.menu(locationId),
    enabled: selfCheckout,
    refetchInterval: REFRESH_MS,
  });
  const { quote, error: quoteError } = useCartQuote(menu.data, session.lines);

  const place = useMutation({
    mutationFn: () =>
      api.placeOrder(locationId, {
        id: session.orderId,
        payment: session.payment,
        customerName: session.customerName.trim() || null,
        items: session.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          variantId: l.variantId,
          modifierIds: l.modifierIds,
          quantity: l.quantity,
          barcode: l.barcode,
        })),
      }),
  });
  const pay = useMutation({
    mutationFn: ({ orderId, paymentId }: { orderId: string; paymentId: string }) =>
      api.pay(locationId, orderId, paymentId),
  });
  const cancel = useMutation({ mutationFn: (orderId: string) => api.cancel(locationId, orderId) });

  const startOver = useCallback(() => {
    setOverlay({ kind: 'none' });
    place.reset();
    pay.reset();
    useSession.getState().reset();
  }, [place, pay]);

  /** The customer left: an order placed for the card terminal but never paid is cancelled. */
  const abandon = useCallback(() => {
    const { order, stage } = useSession.getState();
    if (order && stage === 'paying' && order.paymentStatus === 'UNPAID') {
      void cancel.mutateAsync(order.id).catch(() => null);
    }
    startOver();
  }, [cancel, startOver]);

  const idle = useIdleReset({
    enabled:
      selfCheckout &&
      overlay.kind !== 'attendant' &&
      overlay.kind !== 'pin' &&
      (session.stage === 'menu' ||
        session.stage === 'checkout' ||
        (session.stage === 'paying' && !pay.isPending)),
    onIdle: abandon,
  });

  const added = (name: string) => {
    const count = useSession.getState().lines.reduce((sum, l) => sum + l.quantity, 0);
    announce(t('a11y.added', { name, count }));
  };

  const addProduct = (
    product: PublishedMenuProduct,
    choice: OptionsChoice,
    barcode: string | null,
  ) => {
    session.addLine({
      productId: product.id,
      variantId: choice.variantId,
      modifierIds: choice.modifierIds,
      quantity: choice.quantity,
      // A scanned code stays with its line unless another variant was chosen.
      barcode,
    });
    added(pickLocalized(product, 'name', locale));
  };

  const select = (
    product: PublishedMenuProduct,
    variantId: string | null = null,
    barcode: string | null = null,
  ) => {
    const needsChoice =
      (product.variants.length > 0 && variantId === null) ||
      product.modifierGroups.some((g) => g.minSelect > 0) ||
      (barcode === null && product.modifierGroups.length > 0);
    if (!needsChoice) {
      const modifierIds = product.modifierGroups.flatMap((g) =>
        g.modifiers.filter((m) => m.isDefault).map((m) => m.id),
      );
      addProduct(product, { variantId, modifierIds, quantity: 1 }, barcode);
      return;
    }
    setOverlay({ kind: 'options', product, variantId, barcode });
  };

  /** A scanned or typed code, looked up in the kiosk's copy of the menu (ADR 0021): offline. */
  const scan = (code: string, data: PublishedMenu | undefined) => {
    if (!data) return;
    if (useSession.getState().stage === 'welcome') session.start();
    const match = lookupCode(data, code);
    if (!match) {
      announce(t('scan.unknown', { code }));
      setNotice({ text: t('scan.unknown', { code }), error: true });
      return;
    }
    const name = [match.product, ...(match.variant ? [match.variant] : [])]
      .map((item) => pickLocalized(item, 'name', locale))
      .join(' · ');
    if (!match.product.isAvailable) {
      setNotice({ text: t('scan.soldOut', { name }), error: true });
      return;
    }
    select(
      match.product,
      match.variant?.id ?? null,
      match.matchedBy === 'BARCODE' ? match.code : null,
    );
    setNotice({ text: t('scan.added', { name }), error: false });
  };
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => {
      setNotice(null);
    }, 4000);
    return () => {
      clearTimeout(id);
    };
  }, [notice]);
  const scanner = useBarcodeScanner(
    (event: ScanEvent) => {
      scan(event.code, menu.data);
    },
    {
      enabled:
        selfCheckout &&
        barcodes &&
        overlay.kind === 'none' &&
        (session.stage === 'welcome' || session.stage === 'menu'),
    },
  );

  const chargeAtTerminal = async (order: Order) => {
    try {
      const outcome = await pay.mutateAsync({
        orderId: order.id,
        paymentId: useSession.getState().paymentId,
      });
      if (outcome.payment.status === 'CAPTURED') session.paid(outcome.order);
      else session.decline(outcome.order);
    } catch {
      // A lost answer: "Try again" resends the same payment id, which never charges twice.
    }
  };

  const submit = async () => {
    try {
      const order = await place.mutateAsync();
      session.placed(order);
      if (session.payment === 'COUNTER') {
        session.setStage('done');
        return;
      }
      session.setStage('paying');
      await chargeAtTerminal(order);
    } catch {
      // shown on the checkout screen; resending reuses the order id
    }
  };

  const content = () => {
    if (!selfCheckout) return <UnavailableScreen />;
    if (session.stage === 'welcome') {
      return <WelcomeScreen scanning={barcodes} onStart={session.start} />;
    }
    if (!menu.data) {
      return (
        <main className="grid flex-1 place-items-center">
          <Spinner label={t('menu.loading')} className="size-12" />
        </main>
      );
    }
    if (session.stage === 'checkout') {
      return (
        <CheckoutScreen
          menu={menu.data}
          lines={session.lines}
          quote={quote}
          customerName={session.customerName}
          payment={session.payment}
          pending={place.isPending}
          error={place.error}
          onName={session.setCustomerName}
          onPayment={session.setPayment}
          onBack={() => {
            session.setStage('menu');
          }}
          onSubmit={() => void submit()}
        />
      );
    }
    if (session.stage === 'paying') {
      return (
        <PayingScreen
          declined={session.declined}
          pending={pay.isPending}
          error={pay.error}
          onRetry={() => {
            const order = useSession.getState().order;
            if (order) void chargeAtTerminal(order);
          }}
          onCounter={() => {
            session.setStage('done');
          }}
          onCancel={abandon}
        />
      );
    }
    if (session.stage === 'done' && session.order) {
      return <DoneScreen order={session.order} onDone={startOver} />;
    }
    return (
      <main className="flex min-h-0 flex-1">
        <MenuScreen
          menu={menu.data}
          scanning={barcodes}
          onSelect={(product) => {
            select(product);
          }}
          onTypeCode={() => {
            setOverlay({ kind: 'barcode' });
          }}
        />
        <CartPanel
          menu={menu.data}
          lines={session.lines}
          quote={quote}
          problem={quoteError !== null}
          actions={{
            setQuantity: session.setQuantity,
            removeLine: (id) => {
              const line = session.lines.find((l) => l.id === id);
              session.removeLine(id);
              if (line)
                announce(t('a11y.removed', { name: lineName(menu.data, line, locale).name }));
            },
          }}
          onCheckout={() => {
            session.setStage('checkout');
          }}
          className="w-[26rem]"
        />
      </main>
    );
  };

  const shopping = session.stage === 'menu' || session.stage === 'checkout';
  return (
    <div className="flex h-full flex-col" data-stage={session.stage}>
      {session.stage === 'welcome' && selfCheckout ? null : (
        <KioskHeader
          onStartOver={shopping ? startOver : null}
          onAttendant={() => {
            setOverlay({ kind: 'pin' });
          }}
        />
      )}
      {content()}
      {session.stage === 'welcome' && selfCheckout ? (
        <button
          type="button"
          className="fixed end-3 bottom-3 min-h-12 rounded-lg px-3 text-sm text-muted-foreground"
          onClick={() => {
            setOverlay({ kind: 'pin' });
          }}
        >
          {t('attendant.open')}
        </button>
      ) : null}
      {notice ? (
        <div
          role="status"
          data-testid="scan-notice"
          className={
            notice.error
              ? 'fixed inset-x-0 bottom-6 mx-auto w-fit rounded-xl bg-destructive px-6 py-4 text-xl font-semibold text-destructive-foreground'
              : 'fixed inset-x-0 bottom-6 mx-auto w-fit rounded-xl bg-success px-6 py-4 text-xl font-semibold text-success-foreground'
          }
        >
          {notice.text}
        </div>
      ) : null}
      {idle.warning !== null ? (
        <IdleOverlay seconds={idle.warning} onContinue={idle.dismiss} />
      ) : null}
      <Dialog
        open={overlay.kind !== 'none'}
        onOpenChange={(open) => {
          if (!open) setOverlay({ kind: 'none' });
        }}
      >
        {overlay.kind === 'options' && menu.data ? (
          <OptionsDialog
            product={overlay.product}
            currency={menu.data.currencyCode}
            initialVariantId={overlay.variantId}
            onConfirm={(choice) => {
              addProduct(
                overlay.product,
                choice,
                overlay.barcode && choice.variantId === overlay.variantId ? overlay.barcode : null,
              );
              setOverlay({ kind: 'none' });
            }}
          />
        ) : null}
        {overlay.kind === 'barcode' ? (
          <BarcodeDialog
            onSubmit={(code) => {
              setOverlay({ kind: 'none' });
              scanner.submit(code);
            }}
          />
        ) : null}
        {overlay.kind === 'pin' ? (
          <AttendantPinDialog
            onOpen={(attendant) => {
              setOverlay({ kind: 'attendant', attendant });
            }}
          />
        ) : null}
        {overlay.kind === 'attendant' ? (
          <AttendantMenu
            attendant={overlay.attendant}
            kiosk={kiosk}
            version={KIOSK_VERSION}
            onResume={() => {
              setOverlay({ kind: 'none' });
            }}
            onReload={() => {
              void queryClient.invalidateQueries();
              setOverlay({ kind: 'none' });
            }}
            onUnpair={() => {
              startOver();
              queryClient.clear();
              forget();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
