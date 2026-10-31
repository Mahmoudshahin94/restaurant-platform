import { PLATFORM_BRAND } from '@pos/shared-types';
import { cn } from '@pos/ui';
import { useTranslation } from 'react-i18next';

/**
 * The platform's mark and wordmark as inline SVG (design finding L1). It is 132 x 32: size it by
 * height only (`h-7 w-auto`), never into a square box. Every part draws in a theme colour, so it
 * reads in light and dark (an `<img>` of the file cannot, its `currentColor` renders black).
 */
export function BrandLogo({ className, label }: { className?: string; label?: string }) {
  const { t } = useTranslation('common');
  return (
    <svg
      role="img"
      aria-label={label ?? t('platform.products.platform')}
      viewBox="0 0 132 32"
      className={cn('h-7 w-auto shrink-0', className)}
      // The wordmark is Latin script: it never mirrors in right-to-left.
      direction="ltr"
    >
      <ellipse
        cx="16"
        cy="16"
        rx="12"
        ry="6"
        transform="rotate(-28 16 16)"
        strokeWidth="2.2"
        className="fill-none stroke-primary"
      />
      <circle cx="16" cy="16" r="4.6" className="fill-foreground" />
      <circle cx="26" cy="11" r="2.2" className="fill-accent" />
      <text
        x="36"
        y="22.5"
        fontSize="17"
        fontWeight="700"
        letterSpacing="2.5"
        className="fill-foreground font-sans"
      >
        {PLATFORM_BRAND.name}
      </text>
    </svg>
  );
}
