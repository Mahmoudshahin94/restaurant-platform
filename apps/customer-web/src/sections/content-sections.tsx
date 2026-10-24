import { SectionAlignment, SectionBackground, type WebsiteSectionType } from '@pos/shared-types';
import { buttonVariants, cn } from '@pos/ui';
import type { WebsiteSectionOf } from '@pos/validation';
import { Mail, MapPin, Phone, Quote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  SectionFrame,
  SiteLink,
  siteImageUrl,
  useLocalizedText,
  useSiteContext,
} from './section-kit';

type Props<T extends WebsiteSectionType> = { section: WebsiteSectionOf<T> };

/** A call to action drawn on the section's own background. */
function ctaClass(background: SectionBackground): string {
  return background === SectionBackground.PRIMARY
    ? buttonVariants({ size: 'lg', variant: 'secondary' })
    : buttonVariants({ size: 'lg' });
}

export function HeroSection({ section }: Props<'HERO'>) {
  const text = useLocalizedText();
  const { title, subtitle, cta, imageFileId } = section.content;
  const centered = section.appearance.alignment === SectionAlignment.CENTER;
  return (
    <SectionFrame section={section} className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
      <div className={cn('grid gap-3', centered && 'justify-items-center md:col-span-2')}>
        <h1 id={`${section.id}-title`} className="text-3xl font-bold tracking-tight sm:text-4xl">
          {text(title)}
        </h1>
        {text(subtitle) ? <p className="max-w-2xl text-lg opacity-90">{text(subtitle)}</p> : null}
        {cta ? (
          <SiteLink link={cta} className={cn(ctaClass(section.appearance.background), 'w-fit')} />
        ) : null}
      </div>
      {imageFileId ? (
        <img
          src={siteImageUrl(imageFileId)}
          alt=""
          className={cn(
            'max-h-72 w-full rounded-lg object-cover md:w-80',
            centered && 'md:col-span-2 md:w-full',
          )}
        />
      ) : null}
    </SectionFrame>
  );
}

export function AboutSection({ section }: Props<'ABOUT'>) {
  const text = useLocalizedText();
  const { title, body, imageFileId } = section.content;
  return (
    <SectionFrame section={section} title={text(title)}>
      <div className={cn('grid gap-6', imageFileId && 'md:grid-cols-2 md:items-center')}>
        <p className="whitespace-pre-line leading-relaxed">{text(body)}</p>
        {imageFileId ? (
          <img
            src={siteImageUrl(imageFileId)}
            alt=""
            className="max-h-80 w-full rounded-lg object-cover"
          />
        ) : null}
      </div>
    </SectionFrame>
  );
}

export function GallerySection({ section }: Props<'GALLERY'>) {
  const text = useLocalizedText();
  if (section.content.images.length === 0) return null;
  return (
    <SectionFrame section={section} title={text(section.content.title)}>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {section.content.images.map((image) => (
          <li key={image.fileId}>
            <figure className="grid gap-1">
              <img
                src={siteImageUrl(image.fileId)}
                alt={text(image.caption)}
                className="aspect-square w-full rounded-lg object-cover"
                loading="lazy"
              />
              {text(image.caption) ? (
                <figcaption className="text-sm opacity-80">{text(image.caption)}</figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}

export function TestimonialsSection({ section }: Props<'TESTIMONIALS'>) {
  const text = useLocalizedText();
  if (section.content.items.length === 0) return null;
  return (
    <SectionFrame section={section} title={text(section.content.title)}>
      <ul className="grid gap-4 md:grid-cols-2">
        {section.content.items.map((item, index) => (
          <li
            key={`${item.author}-${String(index)}`}
            className="rounded-lg border bg-card p-5 text-card-foreground"
          >
            <figure className="grid gap-3 text-start">
              <Quote aria-hidden className="size-5 text-primary" />
              <blockquote className="leading-relaxed">{text(item.quote)}</blockquote>
              <figcaption className="text-sm font-medium text-muted-foreground">
                — {item.author}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}

export function PromoBannerSection({ section }: Props<'PROMO_BANNER'>) {
  const text = useLocalizedText();
  const { cta } = section.content;
  return (
    <SectionFrame section={section} className="flex flex-wrap items-center justify-center gap-4">
      <p className="text-lg font-semibold">{text(section.content.text)}</p>
      {cta ? <SiteLink link={cta} className={ctaClass(section.appearance.background)} /> : null}
    </SectionFrame>
  );
}

export function ContactSection({ section }: Props<'CONTACT'>) {
  const { t } = useTranslation('customer');
  const text = useLocalizedText();
  const { phone, email, address } = section.content;
  const centered = section.appearance.alignment === SectionAlignment.CENTER;
  return (
    <SectionFrame section={section} title={text(section.content.title)}>
      <ul className={cn('grid gap-2', centered && 'justify-items-center')}>
        {phone ? (
          <li className="flex items-center gap-2">
            <Phone aria-hidden className="size-4" />
            <span className="sr-only">{t('site.contact.phone')}</span>
            <a
              href={`tel:${phone.replace(/[^+\d]/g, '')}`}
              className="underline-offset-4 hover:underline"
            >
              <bdi className="ltr-nums">{phone}</bdi>
            </a>
          </li>
        ) : null}
        {email ? (
          <li className="flex items-center gap-2">
            <Mail aria-hidden className="size-4" />
            <span className="sr-only">{t('site.contact.email')}</span>
            <a href={`mailto:${email}`} className="underline-offset-4 hover:underline">
              <bdi>{email}</bdi>
            </a>
          </li>
        ) : null}
        {text(address) ? (
          <li className="flex items-center gap-2">
            <MapPin aria-hidden className="size-4" />
            <span className="sr-only">{t('site.contact.address')}</span>
            {text(address)}
          </li>
        ) : null}
      </ul>
    </SectionFrame>
  );
}

/** The page's last block: the tenant's text, its navigation and its social links. */
export function FooterSection({ section }: Props<'FOOTER'>) {
  const { t } = useTranslation('customer');
  const text = useLocalizedText();
  const site = useSiteContext();
  const { navigation, social } = site.website;
  return (
    <SectionFrame section={section} className="grid gap-4">
      {navigation.length > 0 ? (
        <nav aria-label={t('site.footerNavigation')}>
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-medium">
            {navigation.map((link) => (
              <li key={link.href}>
                <SiteLink link={link} className="underline-offset-4 hover:underline" />
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {social.length > 0 ? (
        <ul
          className="flex flex-wrap justify-center gap-3 text-sm"
          aria-label={t('site.social.title')}
        >
          {social.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border px-3 py-1 hover:bg-card"
              >
                {t(`site.social.${link.network}`)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {text(section.content.text) ? (
        <p className="text-center text-sm opacity-80">{text(section.content.text)}</p>
      ) : null}
    </SectionFrame>
  );
}
