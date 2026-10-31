import { TenantLogo, useCurrentLocale, useErrorText } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { AuthBrand } from '@pos/validation';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@pos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, LayoutDashboard } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router';
import { api, session } from '../lib/api';
import { usePreferences } from '../stores/preferences';
import { useSession } from '../stores/session';

/** A brand's first letter in a square: other brands' logos cannot be fetched with this token. */
function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-sm bg-primary-subtle text-caption font-semibold"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * The brand and organization switcher at the top of the sidebar (E1 §5): the organization's
 * overview and each brand, the current one checked. Choosing a brand signs into it
 * (`/auth/switch`), replaces the session, clears every cached query and opens its dashboard; a
 * failure leaves the person where they are, with a toast. A person with one brand and no
 * organization sees the brand's name and no menu.
 */
export function BrandSwitcher() {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const user = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const orgMatch = useMatch('/org/:organizationId/*');
  const [switching, setSwitching] = useState(false);

  if (!user) return null;
  const { tenants, organizations } = user;
  const brandName = (brand: AuthBrand) => pickLocalized(brand, 'name', locale);
  const current = tenants.find((b) => b.id === user.tenantId);

  if (tenants.length <= 1 && organizations.length === 0) {
    const name = current ? brandName(current) : '';
    return (
      <div className="flex h-10 items-center px-2">
        <TenantLogo fallback={<span className="truncate font-semibold">{name}</span>} />
      </div>
    );
  }

  const organizationId = orgMatch?.params.organizationId;
  const organization = organizations.find((o) => o.id === organizationId);
  const triggerName = organization
    ? pickLocalized(organization, 'name', locale)
    : current
      ? brandName(current)
      : '';
  const value = organization ? `org:${organization.id}` : `brand:${user.tenantId}`;
  const standalone = tenants.filter((b) => !organizations.some((o) => o.id === b.organizationId));

  const choose = async (next: string) => {
    if (next === value) return;
    if (next.startsWith('org:')) {
      void navigate(`/org/${next.slice('org:'.length)}`);
      return;
    }
    const tenantId = next.slice('brand:'.length);
    if (tenantId === user.tenantId) {
      void navigate('/');
      return;
    }
    setSwitching(true);
    try {
      const response = await api.auth.switch(tenantId);
      // Cleared before the new session lands, so nothing of the old brand is ever shown or reused.
      queryClient.clear();
      // The chosen location belonged to the old brand.
      usePreferences.getState().setLocationId(null);
      session.replaceSession(response);
      void navigate('/');
    } catch (error) {
      toast({
        title: t('switcher.failed'),
        description: errorText(error),
        variant: 'destructive',
      });
    } finally {
      setSwitching(false);
    }
  };

  const brandItem = (brand: AuthBrand) => (
    <DropdownMenuRadioItem key={brand.id} value={`brand:${brand.id}`} disabled={switching}>
      <Initial name={brandName(brand)} />
      <span className="truncate">{brandName(brand)}</span>
    </DropdownMenuRadioItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between gap-2 px-2" loading={switching}>
          <span className="flex min-w-0 items-center gap-2">
            <Initial name={triggerName} />
            <span className="truncate">{triggerName}</span>
            <span className="sr-only">{t('switcher.label')}</span>
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            void choose(next);
          }}
        >
          {organizations.map((org, index) => (
            <Fragment key={org.id}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{pickLocalized(org, 'name', locale)}</DropdownMenuLabel>
              <DropdownMenuRadioItem value={`org:${org.id}`} disabled={switching}>
                <LayoutDashboard aria-hidden />
                {t('switcher.overview')}
              </DropdownMenuRadioItem>
              {tenants.filter((b) => b.organizationId === org.id).map(brandItem)}
            </Fragment>
          ))}
          {standalone.length > 0 ? (
            <>
              {organizations.length > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{t('switcher.brands')}</DropdownMenuLabel>
              {standalone.map(brandItem)}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
