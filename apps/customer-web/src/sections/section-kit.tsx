import { useCurrentLocale } from '@pos/app-kit';
import { SectionAlignment, SectionBackground } from '@pos/shared-types';
import { cn } from '@pos/ui';
import type { LocalizedText, PublicSite, WebsiteLink, WebsiteSection } from '@pos/validation';
import { createContext, type ReactNode, useCallback, useContext } from 'react';
import { Link } from 'react-router';
import { storefront } from '../lib/api';

/** The site a section belongs to (its locations, languages and names). */
export const SiteContext = createContext<PublicSite | null>(null);

export function useSiteContext(): PublicSite {
  const site = useContext(SiteContext);
  if (!site) throw new Error('A website section needs its site');
  return site;
}

/**
 * Text of the tenant's website in the visitor's language, else the store's default language,
 * else whichever language has it (ADR 0020): a section is never blank because one translation
 * is missing.
 */
export function useLocalizedText(): (text: LocalizedText | undefined) => string {
  const locale = useCurrentLocale();
  const fallback = useContext(SiteContext)?.locales.default;
  return useCallback(
    (text) => {
      if (!text) return '';
      return (
        text[locale] ??
        (fallback ? text[fallback] : undefined) ??
        text.en ??
        text.ar ??
        ''
      ).trim();
    },
    [locale, fallback],
  );
}

/** A public picture of the site (its sections' images, uploaded by the tenant). */
export const siteImageUrl = (fileId: string) => storefront.fileUrl(fileId);

const BACKGROUNDS: Record<SectionBackground, string> = {
  DEFAULT: '',
  MUTED: 'bg-muted',
  PRIMARY: 'bg-primary text-primary-foreground',
};

/**
 * The frame of every section: its anchor (`#id`, for the navigation), its heading for assistive
 * technology, and its appearance (background, alignment), all from design tokens, so the tenant's
 * colours and both themes apply.
 */
export function SectionFrame({
  section,
  title,
  children,
  className,
}: {
  section: WebsiteSection;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const { background, alignment } = section.appearance;
  const headingId = `${section.id}-title`;
  return (
    <section
      id={section.id}
      aria-labelledby={title ? headingId : undefined}
      data-section-type={section.type}
      className={cn(
        'scroll-mt-20 rounded-xl',
        background === SectionBackground.DEFAULT ? 'py-6' : 'px-5 py-8 sm:px-8',
        BACKGROUNDS[background],
        alignment === SectionAlignment.CENTER ? 'text-center' : 'text-start',
        className,
      )}
    >
      {title ? (
        <h2 id={headingId} className="mb-4 text-2xl font-semibold tracking-tight">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A link of the website: a section of the page, a page of the site, or an outside page (opened
 * in a new tab, with no access to this one). The schema allows nothing else.
 */
export function SiteLink({
  link,
  className,
  children,
}: {
  link: WebsiteLink;
  className?: string;
  children?: ReactNode;
}) {
  const text = useLocalizedText();
  const label = children ?? text(link.label);
  if (link.href.startsWith('https://')) {
    return (
      <a href={link.href} className={className} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }
  if (link.href.startsWith('#')) {
    // A section of the home page: scrolls there on the home page, opens it from any other page.
    return (
      <a href={`/${link.href}`} className={className}>
        {label}
      </a>
    );
  }
  return (
    <Link to={link.href} className={className}>
      {label}
    </Link>
  );
}
