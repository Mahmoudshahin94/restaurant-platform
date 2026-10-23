import { QueryState, brandingVariables, useCurrentLocale } from '@pos/app-kit';
import {
  BRAND_FOREGROUNDS,
  type ContrastIssue,
  PLATFORM_BRANDING_DEFAULTS,
  brandingContrastIssues,
  normalizeHex,
  resolveBranding,
} from '@pos/domain';
import {
  BORDER_RADIUS_MAX,
  BORDER_RADIUS_MIN,
  BRAND_SURFACES,
  type BrandSurface,
  type BrandingLayer,
  FONT_FAMILIES,
  LOGO_SIZES,
  type ResolvedBranding,
  SURFACE_STYLES,
  TENANT_FILE_MAX_BYTES,
  THEME_MODES,
  type TenantFileKind,
} from '@pos/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  NativeSelect,
  PageHeader,
} from '@pos/ui';
import type { TenantBrandingDto, UpdateBrandingRequest } from '@pos/validation';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { keys, useAdminMutation, useTenant, useTenantId } from '../../lib/queries';

type Values = Omit<UpdateBrandingRequest, 'surfaces'>;
type Draft = Values & { surfaces: Partial<Record<BrandSurface, BrandingLayer>> };
/** What a screen may set differently from the business on this page. */
type SurfaceKey = 'themeMode' | 'primaryColor' | 'accentColor' | 'surfaceStyle' | 'logoFileId';

const ACCEPT: Record<TenantFileKind, string> = {
  LOGO: 'image/png,image/jpeg,image/webp',
  FAVICON: 'image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico',
};

function draftOf(data: TenantBrandingDto): Draft {
  return { ...data.tenant, surfaces: data.surfaces };
}

/** The request: values as they are, surfaces without the screens' unset values. */
function requestOf(draft: Draft): UpdateBrandingRequest {
  const surfaces: UpdateBrandingRequest['surfaces'] = {};
  for (const surface of BRAND_SURFACES) {
    const layer = Object.fromEntries(
      Object.entries(draft.surfaces[surface] ?? {}).filter(([, v]) => (v as unknown) != null),
    );
    if (Object.keys(layer).length > 0) surfaces[surface] = layer;
  }
  return { ...draft, surfaces };
}

/** A colour as typed: only a complete `#rrggbb` is taken (`#256` is not yet `#225566`). */
const FULL_HEX = /^#[0-9a-f]{6}$/i;

const kb = (bytes: number) => `${String(Math.round(bytes / 1024))} KB`;

/**
 * The tenant's branding (ADR 0019): names, logo and favicon, colours, light or dark, cards,
 * corners and typeface, and the screens that differ. A live preview shows the result in both
 * themes, and colours that would be unreadable are flagged before saving (the API refuses them
 * too).
 */
export function BrandingPage() {
  const { t } = useTranslation(['admin']);
  const tid = useTenantId();
  const branding = useQuery({ queryKey: keys.branding(tid), queryFn: () => api.branding.get(tid) });
  return (
    <div className="grid max-w-6xl gap-6">
      <PageHeader title={t('admin:branding.title')} description={t('admin:branding.description')} />
      <QueryState query={branding}>
        {(data) => <BrandingForm key={data.updatedAt ?? 'new'} initial={data} />}
      </QueryState>
    </div>
  );
}

function BrandingForm({ initial }: { initial: TenantBrandingDto }) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const tid = useTenantId();
  const tenant = useTenant();
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [screen, setScreen] = useState<BrandSurface>('pos');
  const [previewMode, setPreviewMode] = useState<'DARK' | 'LIGHT'>('DARK');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useAdminMutation(
    (body: UpdateBrandingRequest) => api.branding.update(tid, body),
    ['branding', 'tenant-context'],
  );

  const names = {
    nameEn: tenant.data?.nameEn ?? initial.resolved.displayNameEn,
    nameAr: tenant.data?.nameAr ?? initial.resolved.displayNameAr,
  };
  const issues = useMemo(() => brandingContrastIssues(draft, draft.surfaces), [draft]);
  const preview = useMemo(
    () =>
      resolveBranding({
        tenantNames: names,
        tenant: draft,
        surfaces: draft.surfaces,
        surface: screen,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- names are strings
    [draft, screen, names.nameEn, names.nameAr],
  );

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const setOnScreen = <K extends SurfaceKey>(key: K, value: Values[K] | null) => {
    setSaved(false);
    setDraft((d) => ({
      ...d,
      surfaces: { ...d.surfaces, [screen]: { ...d.surfaces[screen], [key]: value } },
    }));
  };
  const issueFor = (path: string[]) =>
    issues.find((i) => i.path.join('.') === path.join('.')) ?? null;

  const submit = () => {
    setError(null);
    save.mutate(requestOf(draft), {
      onSuccess: () => {
        setSaved(true);
      },
      onError: (e) => {
        setError(errorText(e));
      },
    });
  };

  const onScreen = draft.surfaces[screen] ?? {};
  const inheritLabel = (value: string) => t('admin:branding.sameAsBusinessValue', { value });
  const onScreenLabel = (setting: string) =>
    t('admin:branding.screenSetting', {
      setting,
      screen: t(`admin:branding.surfaces.${screen}`),
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin:branding.identity')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('admin:branding.displayNameEn')}
              hint={t('admin:branding.displayNameHint', { name: names.nameEn })}
            >
              <Input
                dir="ltr"
                value={draft.displayNameEn ?? ''}
                placeholder={names.nameEn}
                onChange={(e) => {
                  set('displayNameEn', e.target.value.trim() ? e.target.value : null);
                }}
              />
            </Field>
            <Field
              label={t('admin:branding.displayNameAr')}
              hint={t('admin:branding.displayNameHint', { name: names.nameAr })}
            >
              <Input
                dir="rtl"
                lang="ar"
                value={draft.displayNameAr ?? ''}
                placeholder={names.nameAr}
                onChange={(e) => {
                  set('displayNameAr', e.target.value.trim() ? e.target.value : null);
                }}
              />
            </Field>
            <FilePicker
              kind="LOGO"
              label={t('admin:branding.logo')}
              hint={t('admin:branding.logoHint', { size: kb(TENANT_FILE_MAX_BYTES.LOGO) })}
              fileId={draft.logoFileId ?? null}
              onChange={(id) => {
                set('logoFileId', id);
              }}
            />
            <FilePicker
              kind="FAVICON"
              label={t('admin:branding.favicon')}
              hint={t('admin:branding.faviconHint', { size: kb(TENANT_FILE_MAX_BYTES.FAVICON) })}
              fileId={draft.faviconFileId ?? null}
              onChange={(id) => {
                set('faviconFileId', id);
              }}
            />
            <Field label={t('admin:branding.logoSize')}>
              <NativeSelect
                value={draft.logoSize ?? ''}
                onChange={(e) => {
                  set('logoSize', (e.target.value || null) as Values['logoSize']);
                }}
              >
                <option value="">
                  {t('admin:branding.inherit', {
                    value: t(`admin:branding.logoSizes.${PLATFORM_BRANDING_DEFAULTS.logoSize}`),
                  })}
                </option>
                {LOGO_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {t(`admin:branding.logoSizes.${size}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin:branding.colours')}</CardTitle>
            <CardDescription>{t('admin:branding.coloursHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {(['primaryColor', 'secondaryColor', 'accentColor'] as const).map((key) => (
              <ColourField
                key={key}
                label={t(`admin:branding.${key}`)}
                hint={t(`admin:branding.${key.replace('Color', 'Hint') as 'primaryHint'}`)}
                value={draft[key] ?? null}
                issue={issueFor([key])}
                onChange={(value) => {
                  set(key, value);
                }}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin:branding.look')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin:branding.themeMode')} hint={t('admin:branding.themeModeHint')}>
              <NativeSelect
                value={draft.themeMode ?? ''}
                onChange={(e) => {
                  set('themeMode', (e.target.value || null) as Values['themeMode']);
                }}
              >
                <option value="">
                  {t('admin:branding.inherit', {
                    value: t(`admin:branding.themeModes.${PLATFORM_BRANDING_DEFAULTS.themeMode}`),
                  })}
                </option>
                {THEME_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`admin:branding.themeModes.${mode}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t('admin:branding.surfaceStyle')}>
              <NativeSelect
                value={draft.surfaceStyle ?? ''}
                onChange={(e) => {
                  set('surfaceStyle', (e.target.value || null) as Values['surfaceStyle']);
                }}
              >
                <option value="">
                  {t('admin:branding.inherit', {
                    value: t(
                      `admin:branding.surfaceStyles.${PLATFORM_BRANDING_DEFAULTS.surfaceStyle}`,
                    ),
                  })}
                </option>
                {SURFACE_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {t(`admin:branding.surfaceStyles.${style}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label={t('admin:branding.borderRadius')}
              hint={t('admin:branding.borderRadiusValue', {
                value: draft.borderRadius ?? PLATFORM_BRANDING_DEFAULTS.borderRadius,
              })}
            >
              <input
                type="range"
                className="h-10 w-full accent-primary"
                min={BORDER_RADIUS_MIN}
                max={BORDER_RADIUS_MAX}
                value={draft.borderRadius ?? PLATFORM_BRANDING_DEFAULTS.borderRadius}
                onChange={(e) => {
                  set('borderRadius', Number(e.target.value));
                }}
              />
            </Field>
            <Field label={t('admin:branding.fontFamily')}>
              <NativeSelect
                value={draft.fontFamily ?? ''}
                onChange={(e) => {
                  set('fontFamily', (e.target.value || null) as Values['fontFamily']);
                }}
              >
                <option value="">
                  {t('admin:branding.inherit', {
                    value: t(
                      `admin:branding.fontFamilies.${PLATFORM_BRANDING_DEFAULTS.fontFamily}`,
                    ),
                  })}
                </option>
                {FONT_FAMILIES.map((font) => (
                  <option key={font} value={font}>
                    {t(`admin:branding.fontFamilies.${font}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin:branding.screens')}</CardTitle>
            <CardDescription>{t('admin:branding.screensHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div
              role="tablist"
              aria-label={t('admin:branding.screen')}
              className="flex flex-wrap gap-1"
            >
              {BRAND_SURFACES.map((surface) => (
                <Button
                  key={surface}
                  role="tab"
                  size="sm"
                  aria-selected={screen === surface}
                  variant={screen === surface ? 'default' : 'outline'}
                  onClick={() => {
                    setScreen(surface);
                  }}
                >
                  {t(`admin:branding.surfaces.${surface}`)}
                  {draft.surfaces[surface] &&
                  Object.values(draft.surfaces[surface]).some((v) => (v as unknown) != null) ? (
                    <span aria-hidden>•</span>
                  ) : null}
                </Button>
              ))}
            </div>
            <div role="tabpanel" className="grid gap-4 sm:grid-cols-2">
              <Field label={onScreenLabel(t('admin:branding.themeMode'))}>
                <NativeSelect
                  value={onScreen.themeMode ?? ''}
                  onChange={(e) => {
                    setOnScreen('themeMode', (e.target.value || null) as Values['themeMode']);
                  }}
                >
                  <option value="">
                    {inheritLabel(t(`admin:branding.themeModes.${preview.themeMode}`))}
                  </option>
                  {THEME_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`admin:branding.themeModes.${mode}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={onScreenLabel(t('admin:branding.surfaceStyle'))}>
                <NativeSelect
                  value={onScreen.surfaceStyle ?? ''}
                  onChange={(e) => {
                    setOnScreen('surfaceStyle', (e.target.value || null) as Values['surfaceStyle']);
                  }}
                >
                  <option value="">
                    {inheritLabel(t(`admin:branding.surfaceStyles.${preview.surfaceStyle}`))}
                  </option>
                  {SURFACE_STYLES.map((style) => (
                    <option key={style} value={style}>
                      {t(`admin:branding.surfaceStyles.${style}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {(['primaryColor', 'accentColor'] as const).map((key) => (
                <ColourField
                  key={`${screen}-${key}`}
                  label={onScreenLabel(t(`admin:branding.${key}`))}
                  value={onScreen[key] ?? null}
                  issue={issueFor(['surfaces', screen, key])}
                  emptyLabel={t('admin:branding.sameAsBusiness')}
                  onChange={(value) => {
                    setOnScreen(key, value);
                  }}
                />
              ))}
              <FilePicker
                kind="LOGO"
                label={onScreenLabel(t('admin:branding.logo'))}
                fileId={onScreen.logoFileId ?? null}
                emptyLabel={t('admin:branding.sameAsBusiness')}
                onChange={(id) => {
                  setOnScreen('logoFileId', id);
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:sticky lg:top-4">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{t('admin:branding.preview')}</CardTitle>
            <NativeSelect
              aria-label={t('admin:branding.previewMode')}
              className="h-9 w-auto"
              value={previewMode}
              onChange={(e) => {
                setPreviewMode(e.target.value as 'DARK' | 'LIGHT');
              }}
            >
              <option value="DARK">{t('admin:branding.themeModes.DARK')}</option>
              <option value="LIGHT">{t('admin:branding.themeModes.LIGHT')}</option>
            </NativeSelect>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              {t(`admin:branding.surfaces.${screen}`)}
            </p>
            <BrandingPreview branding={preview} mode={previewMode} />
          </CardContent>
        </Card>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {saved ? <Alert>{t('admin:branding.saved')}</Alert> : null}
        <Button size="lg" disabled={save.isPending || issues.length > 0} onClick={submit}>
          {save.isPending ? t('common:states.saving') : t('admin:branding.save')}
        </Button>
      </div>
    </div>
  );
}

/** One brand colour: a picker, its hex value, "use the default", and why it is unreadable. */
function ColourField({
  label,
  hint,
  value,
  issue,
  emptyLabel,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string | null;
  issue: ContrastIssue | null;
  emptyLabel?: string;
  onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation(['admin']);
  const [text, setText] = useState(value ?? '');
  // Follow changes made elsewhere (the picker, "remove"), not the ones typed here.
  useEffect(() => {
    setText((current) =>
      FULL_HEX.test(current) && normalizeHex(current) === value ? current : (value ?? ''),
    );
  }, [value]);
  const error = issue
    ? t(`admin:branding.unreadable.${issue.against}`, {
        ratio: issue.ratio.toFixed(2),
        required: issue.required,
      })
    : undefined;
  return (
    <Field label={label} hint={error ? undefined : hint} error={error}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1"
          value={value ?? BRAND_FOREGROUNDS.dark}
          onChange={(e) => {
            onChange(normalizeHex(e.target.value));
          }}
        />
        <Input
          dir="ltr"
          aria-label={t('admin:branding.colourValue', { colour: label })}
          className="ltr-nums"
          value={text}
          placeholder={emptyLabel ?? t('admin:branding.useThemeColour')}
          onChange={(e) => {
            const next = e.target.value.trim();
            setText(next);
            if (next === '') onChange(null);
            else if (FULL_HEX.test(next)) onChange(normalizeHex(next));
          }}
        />
        {value ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
            }}
          >
            {t('admin:branding.remove')}
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

/** A logo or favicon: its preview, upload (checked here and by the API) and removal. */
function FilePicker({
  kind,
  label,
  hint,
  fileId,
  emptyLabel,
  onChange,
}: {
  kind: TenantFileKind;
  label: string;
  hint?: string;
  fileId: string | null;
  emptyLabel?: string;
  onChange: (fileId: string | null) => void;
}) {
  const { t } = useTranslation(['admin']);
  const errorText = useAdminErrorText();
  const tid = useTenantId();
  const [error, setError] = useState<string | null>(null);
  const upload = useAdminMutation((file: File) => api.files.upload(tid, kind, file), ['branding']);
  const url = useTenantFileUrl(fileId);

  const choose = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > TENANT_FILE_MAX_BYTES[kind]) {
      setError(t('admin:branding.fileTooLarge', { size: kb(TENANT_FILE_MAX_BYTES[kind]) }));
      return;
    }
    upload.mutate(file, {
      onSuccess: (created) => {
        onChange(created.id);
      },
      onError: (e) => {
        setError(errorText(e));
      },
    });
  };

  return (
    <Field label={label} hint={error ? undefined : hint} error={error ?? undefined}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-12 min-w-24 items-center justify-center rounded-md border bg-muted px-2">
          {url ? (
            <img src={url} alt={label} className="max-h-10 max-w-40 object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">
              {emptyLabel ?? t('admin:branding.none')}
            </span>
          )}
        </div>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
          {upload.isPending
            ? t('admin:branding.uploading')
            : fileId
              ? t('admin:branding.replace')
              : t('admin:branding.upload')}
          <input
            type="file"
            className="sr-only"
            accept={ACCEPT[kind]}
            disabled={upload.isPending}
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {fileId ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
            }}
          >
            {t('admin:branding.remove')}
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

/** An uploaded file, downloaded with the admin's session, as an object URL. */
function useTenantFileUrl(fileId: string | null): string | null {
  const tid = useTenantId();
  const blob = useQuery({
    queryKey: ['tenant-file', tid, fileId],
    queryFn: () => api.files.content(tid, fileId ?? ''),
    enabled: fileId !== null,
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!fileId || !blob.data) {
      setUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(blob.data);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, blob.data]);
  return url;
}

/** A small screen in the chosen theme with the branding applied, independent of the admin's. */
function BrandingPreview({
  branding,
  mode,
}: {
  branding: ResolvedBranding;
  mode: 'DARK' | 'LIGHT';
}) {
  const { t } = useTranslation(['admin']);
  const locale = useCurrentLocale();
  const logo = useTenantFileUrl(branding.logoFileId);
  const name = locale === 'ar' ? branding.displayNameAr : branding.displayNameEn;
  const style = brandingVariables(branding) as CSSProperties;
  return (
    <div
      data-theme={mode.toLowerCase()}
      data-surface={branding.surfaceStyle.toLowerCase()}
      data-testid="branding-preview"
      style={{ ...style, fontFamily: 'var(--font-sans)' }}
      className="rounded-lg border bg-background p-4 text-foreground"
    >
      <PreviewSurface>
        <div className="flex items-center justify-between gap-2">
          {logo ? (
            <img src={logo} alt={name} className="h-8 max-w-32 object-contain" />
          ) : (
            <span className="truncate font-semibold">{name}</span>
          )}
          <Badge className="bg-accent text-accent-foreground">
            {t('admin:branding.previewBadge')}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t('admin:branding.previewText')}</p>
        <div className="flex gap-2">
          <Button size="sm">{t('admin:branding.previewButton')}</Button>
          <Button size="sm" variant="secondary">
            {t('admin:branding.previewSecondary')}
          </Button>
        </div>
      </PreviewSurface>
    </div>
  );
}

function PreviewSurface({ children }: { children: ReactNode }) {
  return <div className="surface grid gap-3 rounded-lg border p-4">{children}</div>;
}
