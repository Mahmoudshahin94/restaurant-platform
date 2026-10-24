import { useCurrentLocale, useSupportedLocales } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import {
  type Locale,
  SECTION_ALIGNMENTS,
  SECTION_BACKGROUNDS,
  WEBSITE_LIMITS,
  WebsiteSectionType,
} from '@pos/shared-types';
import { Button, Checkbox, Field, Input, Label, NativeSelect, Textarea } from '@pos/ui';
import type { LocalizedText, WebsiteLink, WebsiteSection } from '@pos/validation';
import { Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories, useLocations, useProducts } from '../../lib/queries';
import { FilePicker } from '../settings/branding-page';

const DIR: Record<Locale, 'ltr' | 'rtl'> = { en: 'ltr', ar: 'rtl' };

/**
 * One text in every language the tenant offers (ADR 0020): an input per language, each typed in
 * its own direction whatever the admin's language is.
 */
export function LocalizedInput({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: LocalizedText;
  onChange: (value: LocalizedText) => void;
  multiline?: boolean;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locales = useSupportedLocales();
  return (
    <div className={locales.length > 1 ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3'}>
      {locales.map((locale) => {
        const fieldLabel =
          locales.length > 1 ? `${label} (${t(`common:language.${locale}`)})` : label;
        const props = {
          lang: locale,
          dir: DIR[locale],
          value: value[locale] ?? '',
          maxLength: multiline ? WEBSITE_LIMITS.longText : WEBSITE_LIMITS.shortText,
          onChange: (e: { target: { value: string } }) => {
            onChange({ ...value, [locale]: e.target.value });
          },
        };
        return (
          <Field key={locale} label={fieldLabel}>
            {multiline ? <Textarea rows={4} {...props} /> : <Input {...props} />}
          </Field>
        );
      })}
    </div>
  );
}

/** A link's text and where it goes (`#section`, `/page` or `https://…`). */
export function LinkFields({
  label,
  link,
  onChange,
  optional = false,
}: {
  label: string;
  link: WebsiteLink | null;
  onChange: (link: WebsiteLink | null) => void;
  optional?: boolean;
}) {
  const { t } = useTranslation('admin');
  if (!link) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => {
          onChange({ label: {}, href: '#locations' });
        }}
      >
        <Plus aria-hidden className="size-4" />
        {t('website.fields.addButton', { label })}
      </Button>
    );
  }
  return (
    <fieldset className="grid gap-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <LocalizedInput
        label={t('website.fields.linkLabel')}
        value={link.label}
        onChange={(value) => {
          onChange({ ...link, label: value });
        }}
      />
      <Field label={t('website.fields.href')} hint={t('website.fields.hrefHint')}>
        <Input
          dir="ltr"
          value={link.href}
          onChange={(e) => {
            onChange({ ...link, href: e.target.value });
          }}
        />
      </Field>
      {optional ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => {
            onChange(null);
          }}
        >
          {t('website.fields.removeButton')}
        </Button>
      ) : null}
    </fieldset>
  );
}

function ImageField({
  label,
  fileId,
  onChange,
}: {
  label: string;
  fileId: string | null;
  onChange: (fileId: string | null) => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <FilePicker
      kind="WEBSITE_IMAGE"
      label={label}
      hint={t('website.fields.imageHint')}
      fileId={fileId}
      onChange={onChange}
    />
  );
}

/** A set of ids chosen from a list, as checkboxes (none chosen: the section's default). */
function ChoiceList({
  legend,
  hint,
  options,
  chosen,
  max,
  onChange,
}: {
  legend: string;
  hint: string;
  options: { id: string; label: string }[];
  chosen: readonly string[];
  max?: number;
  onChange: (ids: string[]) => void;
}) {
  const baseId = useId();
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <ul className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
        {options.map((option) => {
          const id = `${baseId}-${option.id}`;
          const checked = chosen.includes(option.id);
          return (
            <li key={option.id} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={checked}
                disabled={!checked && max !== undefined && chosen.length >= max}
                onCheckedChange={(on) => {
                  onChange(
                    on === true ? [...chosen, option.id] : chosen.filter((c) => c !== option.id),
                  );
                }}
              />
              <Label htmlFor={id} className="font-normal">
                {option.label}
              </Label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function LocationSelect({
  label,
  value,
  emptyLabel,
  onChange,
}: {
  label: string;
  value: string | null;
  emptyLabel: string;
  onChange: (locationId: string | null) => void;
}) {
  const locale = useCurrentLocale();
  const locations = useLocations();
  return (
    <Field label={label}>
      <NativeSelect
        value={value ?? ''}
        onChange={(e) => {
          onChange(e.target.value === '' ? null : e.target.value);
        }}
      >
        <option value="">{emptyLabel}</option>
        {(locations.data ?? []).map((l) => (
          <option key={l.id} value={l.id}>
            {pickLocalized(l, 'name', locale)}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function ProductChoice({
  chosen,
  onChange,
}: {
  chosen: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const products = useProducts({});
  return (
    <ChoiceList
      legend={t('website.fields.products')}
      hint={t('website.fields.productsHint', { max: WEBSITE_LIMITS.featuredProducts })}
      options={(products.data ?? []).map((p) => ({
        id: p.id,
        label: pickLocalized(p, 'name', locale),
      }))}
      chosen={chosen}
      max={WEBSITE_LIMITS.featuredProducts}
      onChange={onChange}
    />
  );
}

function CategoryChoice({
  chosen,
  onChange,
}: {
  chosen: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const categories = useCategories();
  return (
    <ChoiceList
      legend={t('website.fields.categories')}
      hint={t('website.fields.categoriesHint')}
      options={(categories.data ?? []).map((c) => ({
        id: c.id,
        label: pickLocalized(c, 'name', locale),
      }))}
      chosen={chosen}
      onChange={onChange}
    />
  );
}

/** Where the section sits on the page and how it looks. */
function AppearanceFields({
  section,
  onChange,
}: {
  section: WebsiteSection;
  onChange: (section: WebsiteSection) => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('website.fields.background')}>
        <NativeSelect
          value={section.appearance.background}
          onChange={(e) => {
            const background = SECTION_BACKGROUNDS.find((b) => b === e.target.value);
            if (background)
              onChange({ ...section, appearance: { ...section.appearance, background } });
          }}
        >
          {SECTION_BACKGROUNDS.map((b) => (
            <option key={b} value={b}>
              {t(`website.backgrounds.${b}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t('website.fields.alignment')}>
        <NativeSelect
          value={section.appearance.alignment}
          onChange={(e) => {
            const alignment = SECTION_ALIGNMENTS.find((a) => a === e.target.value);
            if (alignment)
              onChange({ ...section, appearance: { ...section.appearance, alignment } });
          }}
        >
          {SECTION_ALIGNMENTS.map((a) => (
            <option key={a} value={a}>
              {t(`website.alignments.${a}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}

/** The fields of one section, by its type. */
export function SectionFields({
  section,
  onChange,
}: {
  section: WebsiteSection;
  onChange: (section: WebsiteSection) => void;
}) {
  const { t } = useTranslation('admin');
  /** Replaces part of the section's content (the union narrows per case below). */
  const content = <S extends WebsiteSection>(s: S, change: Partial<S['content']>) => {
    onChange({ ...s, content: { ...s.content, ...change } } as WebsiteSection);
  };
  const title = (s: WebsiteSection & { content: { title: LocalizedText } }) => (
    <LocalizedInput
      label={t('website.fields.title')}
      value={s.content.title}
      onChange={(value) => {
        content(s, { title: value });
      }}
    />
  );

  let fields: ReactNode;
  switch (section.type) {
    case WebsiteSectionType.HERO:
      fields = (
        <>
          {title(section)}
          <LocalizedInput
            label={t('website.fields.subtitle')}
            value={section.content.subtitle}
            onChange={(value) => {
              content(section, { subtitle: value });
            }}
          />
          <LinkFields
            label={t('website.fields.cta')}
            link={section.content.cta}
            optional
            onChange={(cta) => {
              content(section, { cta });
            }}
          />
          <ImageField
            label={t('website.fields.image')}
            fileId={section.content.imageFileId}
            onChange={(imageFileId) => {
              content(section, { imageFileId });
            }}
          />
        </>
      );
      break;
    case WebsiteSectionType.FEATURED_PRODUCTS:
      fields = (
        <>
          {title(section)}
          <LocationSelect
            label={t('website.fields.menuOf')}
            value={section.content.locationId}
            emptyLabel={t('website.fields.firstOpenLocation')}
            onChange={(locationId) => {
              content(section, { locationId });
            }}
          />
          <ProductChoice
            chosen={section.content.productIds}
            onChange={(productIds) => {
              content(section, { productIds });
            }}
          />
        </>
      );
      break;
    case WebsiteSectionType.CATEGORIES:
      fields = (
        <>
          {title(section)}
          <CategoryChoice
            chosen={section.content.categoryIds}
            onChange={(categoryIds) => {
              content(section, { categoryIds });
            }}
          />
        </>
      );
      break;
    case WebsiteSectionType.ABOUT:
      fields = (
        <>
          {title(section)}
          <LocalizedInput
            label={t('website.fields.body')}
            multiline
            value={section.content.body}
            onChange={(value) => {
              content(section, { body: value });
            }}
          />
          <ImageField
            label={t('website.fields.image')}
            fileId={section.content.imageFileId}
            onChange={(imageFileId) => {
              content(section, { imageFileId });
            }}
          />
        </>
      );
      break;
    case WebsiteSectionType.GALLERY:
      fields = (
        <>
          {title(section)}
          {section.content.images.map((image, index) => (
            <fieldset key={image.fileId} className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                {t('website.fields.picture', { n: index + 1 })}
              </legend>
              <ImageField
                label={t('website.fields.image')}
                fileId={image.fileId}
                onChange={(fileId) => {
                  content(section, {
                    images: fileId
                      ? section.content.images.map((im, i) =>
                          i === index ? { ...im, fileId } : im,
                        )
                      : section.content.images.filter((_, i) => i !== index),
                  });
                }}
              />
              <LocalizedInput
                label={t('website.fields.caption')}
                value={image.caption}
                onChange={(caption) => {
                  content(section, {
                    images: section.content.images.map((im, i) =>
                      i === index ? { ...im, caption } : im,
                    ),
                  });
                }}
              />
            </fieldset>
          ))}
          {section.content.images.length < WEBSITE_LIMITS.galleryImages ? (
            <ImageField
              label={t('website.fields.addPicture')}
              fileId={null}
              onChange={(fileId) => {
                if (fileId) {
                  content(section, {
                    images: [...section.content.images, { fileId, caption: {} }],
                  });
                }
              }}
            />
          ) : null}
        </>
      );
      break;
    case WebsiteSectionType.TESTIMONIALS:
      fields = (
        <>
          {title(section)}
          {section.content.items.map((item, index) => (
            <fieldset key={index} className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">
                {t('website.fields.testimonial', { n: index + 1 })}
              </legend>
              <LocalizedInput
                label={t('website.fields.quote')}
                multiline
                value={item.quote}
                onChange={(quote) => {
                  content(section, {
                    items: section.content.items.map((it, i) =>
                      i === index ? { ...it, quote } : it,
                    ),
                  });
                }}
              />
              <Field label={t('website.fields.author')}>
                <Input
                  value={item.author}
                  maxLength={WEBSITE_LIMITS.shortText}
                  onChange={(e) => {
                    content(section, {
                      items: section.content.items.map((it, i) =>
                        i === index ? { ...it, author: e.target.value } : it,
                      ),
                    });
                  }}
                />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => {
                  content(section, { items: section.content.items.filter((_, i) => i !== index) });
                }}
              >
                <Trash2 aria-hidden className="size-4" />
                {t('website.fields.removeTestimonial')}
              </Button>
            </fieldset>
          ))}
          {section.content.items.length < WEBSITE_LIMITS.testimonials ? (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                content(section, {
                  items: [...section.content.items, { quote: {}, author: '' }],
                });
              }}
            >
              <Plus aria-hidden className="size-4" />
              {t('website.fields.addTestimonial')}
            </Button>
          ) : null}
        </>
      );
      break;
    case WebsiteSectionType.LOCATIONS:
      fields = title(section);
      break;
    case WebsiteSectionType.CONTACT:
      fields = (
        <>
          {title(section)}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('website.fields.phone')}>
              <Input
                dir="ltr"
                type="tel"
                value={section.content.phone ?? ''}
                onChange={(e) => {
                  content(section, { phone: e.target.value === '' ? null : e.target.value });
                }}
              />
            </Field>
            <Field label={t('website.fields.email')}>
              <Input
                dir="ltr"
                type="email"
                value={section.content.email ?? ''}
                onChange={(e) => {
                  content(section, { email: e.target.value === '' ? null : e.target.value });
                }}
              />
            </Field>
          </div>
          <LocalizedInput
            label={t('website.fields.address')}
            value={section.content.address}
            onChange={(address) => {
              content(section, { address });
            }}
          />
        </>
      );
      break;
    case WebsiteSectionType.OPENING_HOURS:
      fields = (
        <>
          {title(section)}
          <LocationSelect
            label={t('website.fields.hoursOf')}
            value={section.content.locationId}
            emptyLabel={t('website.fields.everyLocation')}
            onChange={(locationId) => {
              content(section, { locationId });
            }}
          />
        </>
      );
      break;
    case WebsiteSectionType.PROMO_BANNER:
      fields = (
        <>
          <LocalizedInput
            label={t('website.fields.text')}
            value={section.content.text}
            onChange={(text) => {
              content(section, { text });
            }}
          />
          <LinkFields
            label={t('website.fields.cta')}
            link={section.content.cta}
            optional
            onChange={(cta) => {
              content(section, { cta });
            }}
          />
        </>
      );
      break;
    case WebsiteSectionType.FOOTER:
      fields = (
        <LocalizedInput
          label={t('website.fields.footerText')}
          value={section.content.text}
          onChange={(text) => {
            content(section, { text });
          }}
        />
      );
      break;
  }

  return (
    <div className="grid gap-4">
      {fields}
      <AppearanceFields section={section} onChange={onChange} />
    </div>
  );
}
