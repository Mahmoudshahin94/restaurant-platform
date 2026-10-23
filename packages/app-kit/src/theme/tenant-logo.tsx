import type { LogoSize } from '@pos/shared-types';
import { cn } from '@pos/ui';
import { useBrandName, useBrandingFileUrl, useTheme } from './theme-provider';

const IMAGE_SIZE: Record<LogoSize, string> = {
  SMALL: 'h-6 max-w-28',
  MEDIUM: 'h-8 max-w-40',
  LARGE: 'h-12 max-w-56',
};
const TEXT_SIZE: Record<LogoSize, string> = {
  SMALL: 'text-sm',
  MEDIUM: 'text-base',
  LARGE: 'text-xl',
};

/**
 * The tenant's logo at the size its branding chose, or its display name when it has no logo
 * (ADR 0019). The name stays available to assistive technology either way. Renders `fallback`
 * (e.g. the platform's name) before any tenant branding is known.
 */
export function TenantLogo({
  className,
  fallback = null,
}: {
  className?: string;
  fallback?: React.ReactNode;
}) {
  const { branding } = useTheme();
  const name = useBrandName();
  const url = useBrandingFileUrl(branding?.logoFileId ?? null);
  if (!branding) return <>{fallback}</>;
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ''}
        className={cn('w-auto object-contain', IMAGE_SIZE[branding.logoSize], className)}
      />
    );
  }
  return (
    <span className={cn('truncate font-semibold', TEXT_SIZE[branding.logoSize], className)}>
      {name}
    </span>
  );
}
