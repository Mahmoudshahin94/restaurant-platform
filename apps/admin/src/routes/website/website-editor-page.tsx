import { QueryState, useCurrentLocale, useFormatOptions } from '@pos/app-kit';
import { formatDateTime } from '@pos/i18n';
import {
  SOCIAL_NETWORKS,
  type SocialNetwork,
  WEBSITE_LIMITS,
  WEBSITE_SECTION_TYPES,
  type WebsiteSectionType,
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
  Switch,
  cn,
} from '@pos/ui';
import { type WebsiteConfig, type WebsiteState, websiteConfigSchema } from '@pos/validation';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { useAdminMutation, useTenant, useTenantId } from '../../lib/queries';
import { FilePicker } from '../settings/branding-page';
import { LinkFields, LocalizedInput, SectionFields } from './section-fields';
import {
  addSection,
  canAdd,
  moveSection,
  removeSection,
  sortedSections,
  updateSection,
} from './website-draft';

export const websiteKey = (tid: string) => ['website', tid] as const;

/**
 * The website editor (ADR 0023): sections switched on and off, reordered, edited in every
 * language the tenant offers; navigation, social links and SEO. The draft is saved here and only
 * reaches visitors when published; the preview opens the tenant's own site with the draft.
 */
export function WebsiteEditorPage() {
  const { t } = useTranslation(['admin']);
  const tid = useTenantId();
  const website = useQuery({
    queryKey: websiteKey(tid),
    queryFn: () => api.admin.website.get(tid),
  });
  // Kept here: the editor starts afresh from what was saved, and the outcome and the section
  // being edited survive that (ADR 0020's notes on remounting forms).
  const [notice, setNotice] = useState<Notice>(null);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="grid gap-6">
      <PageHeader title={t('admin:website.title')} description={t('admin:website.description')} />
      <QueryState query={website}>
        {(state) => (
          <Editor
            key={state.updatedAt ?? 'template'}
            state={state}
            notice={notice}
            setNotice={setNotice}
            selected={selected ?? sortedSections(state.draft)[0]?.id ?? null}
            setSelected={setSelected}
          />
        )}
      </QueryState>
    </div>
  );
}

type Notice = { kind: 'saved' | 'published' | 'error'; text: string } | null;

function Editor({
  state,
  notice,
  setNotice,
  selected,
  setSelected,
}: {
  state: WebsiteState;
  notice: Notice;
  setNotice: (notice: Notice) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const locale = useCurrentLocale();
  const formatOptions = useFormatOptions();
  const timezone = useTenant().data?.timezone ?? 'UTC';
  const [draft, setDraft] = useState<WebsiteConfig>(state.draft);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState<WebsiteSectionType>('GALLERY');

  const save = useAdminMutation(
    (config: WebsiteConfig) => api.admin.website.saveDraft(tid, config),
    ['website'],
  );
  const publish = useAdminMutation(() => api.admin.website.publish(tid), ['website']);
  const preview = useAdminMutation(() => api.admin.website.preview(tid), []);
  const busy = save.isPending || publish.isPending || preview.isPending;

  const change = (next: WebsiteConfig) => {
    setDraft(next);
    setDirty(true);
    setNotice(null);
  };
  const parsed = websiteConfigSchema.safeParse(draft);
  const invalid = parsed.success ? null : parsed.error.issues[0];

  /** Saves the draft if it changed (the API checks it again). */
  const saveDraft = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!parsed.success) {
      setNotice({ kind: 'error', text: t('admin:website.invalid') });
      return false;
    }
    try {
      await save.mutateAsync(parsed.data);
      setDirty(false);
      return true;
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) });
      return false;
    }
  };

  const onSave = async () => {
    if (await saveDraft()) setNotice({ kind: 'saved', text: t('admin:website.saved') });
  };
  const onPublish = async () => {
    if (!(await saveDraft())) return;
    try {
      const published = await publish.mutateAsync(undefined);
      setNotice({
        kind: 'published',
        text: t('admin:website.publishedNotice', { version: published.version }),
      });
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) });
    }
  };
  const onPreview = async () => {
    // Opened before the request, so the browser does not treat it as an unwanted pop-up.
    const tab = window.open('about:blank', '_blank');
    if (!(await saveDraft())) {
      tab?.close();
      return;
    }
    try {
      const link = await preview.mutateAsync(undefined);
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else {
        window.open(link.url, '_blank', 'noopener');
      }
    } catch (error) {
      tab?.close();
      setNotice({ kind: 'error', text: errorText(error) });
    }
  };

  const sections = sortedSections(draft);
  const current = sections.find((s) => s.id === selected) ?? null;

  return (
    <div className="grid gap-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="grid gap-1 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {state.published
                ? t('admin:website.status.published', {
                    version: state.version,
                    date: state.publishedAt
                      ? formatDateTime(state.publishedAt, timezone, locale, formatOptions)
                      : '',
                  })
                : t('admin:website.status.never')}
              {dirty || state.hasUnpublishedChanges ? (
                <Badge variant="secondary">{t('admin:website.status.unpublished')}</Badge>
              ) : null}
            </p>
            <p className="text-muted-foreground">{t('admin:website.status.hint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !dirty} onClick={() => void onSave()}>
              {save.isPending ? t('common:states.saving') : t('admin:website.actions.save')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void onPreview()}>
              <ExternalLink aria-hidden className="size-4" />
              {t('admin:website.actions.preview')}
            </Button>
            <Button disabled={busy} onClick={() => void onPublish()}>
              {t('admin:website.actions.publish')}
            </Button>
          </div>
        </CardContent>
      </Card>
      {notice ? (
        <Alert variant={notice.kind === 'error' ? 'destructive' : undefined}>{notice.text}</Alert>
      ) : null}
      {invalid && dirty ? (
        <Alert variant="destructive">
          {t('admin:website.invalidAt', { path: invalid.path.join(' › ') })}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin:website.sections')}</CardTitle>
            <CardDescription>{t('admin:website.sectionsHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ol className="grid gap-2" aria-label={t('admin:website.sections')}>
              {sections.map((section, index) => {
                const label = t(`admin:website.types.${section.type}`);
                return (
                  <li
                    key={section.id}
                    className={cn(
                      'flex items-center gap-2 rounded-md border p-2',
                      section.id === selected && 'border-primary bg-muted',
                    )}
                  >
                    <Switch
                      checked={section.enabled}
                      aria-label={t('admin:website.actions.show', { section: label })}
                      onCheckedChange={(enabled) => {
                        change(updateSection(draft, section.id, (s) => ({ ...s, enabled })));
                      }}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-start text-sm font-medium"
                      aria-current={section.id === selected ? 'true' : undefined}
                      onClick={() => {
                        setSelected(section.id);
                      }}
                    >
                      {label}
                      <span className="ms-1 text-xs text-muted-foreground" dir="ltr">
                        #{section.id}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      aria-label={t('admin:website.actions.moveUp', { section: label })}
                      onClick={() => {
                        change(moveSection(draft, section.id, -1));
                      }}
                    >
                      <ArrowUp aria-hidden className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === sections.length - 1}
                      aria-label={t('admin:website.actions.moveDown', { section: label })}
                      onClick={() => {
                        change(moveSection(draft, section.id, 1));
                      }}
                    >
                      <ArrowDown aria-hidden className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('admin:website.newSection')} className="min-w-0 flex-1">
                <NativeSelect
                  value={adding}
                  onChange={(e) => {
                    const type = WEBSITE_SECTION_TYPES.find((s) => s === e.target.value);
                    if (type) setAdding(type);
                  }}
                >
                  {WEBSITE_SECTION_TYPES.map((type) => (
                    <option key={type} value={type} disabled={!canAdd(draft, type)}>
                      {t(`admin:website.types.${type}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Button
                variant="outline"
                disabled={!canAdd(draft, adding)}
                onClick={() => {
                  const added = addSection(draft, adding);
                  if (!added) return;
                  change(added.config);
                  setSelected(added.id);
                }}
              >
                <Plus aria-hidden className="size-4" />
                {t('admin:website.actions.add')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          {current ? (
            <>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <CardTitle>{t(`admin:website.types.${current.type}`)}</CardTitle>
                  <CardDescription>{t(`admin:website.typeHints.${current.type}`)}</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    change(removeSection(draft, current.id));
                    setSelected(null);
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                  {t('admin:website.actions.remove')}
                </Button>
              </CardHeader>
              <CardContent>
                <SectionFields
                  key={current.id}
                  section={current}
                  onChange={(next) => {
                    change(updateSection(draft, current.id, () => next));
                  }}
                />
              </CardContent>
            </>
          ) : (
            <CardContent className="pt-6 text-sm text-muted-foreground">
              {t('admin:website.noSelection')}
            </CardContent>
          )}
        </Card>
      </div>

      <SiteSettings draft={draft} onChange={change} />
    </div>
  );
}

/** The navigation, social links and search-engine text of the whole site. */
function SiteSettings({
  draft,
  onChange,
}: {
  draft: WebsiteConfig;
  onChange: (config: WebsiteConfig) => void;
}) {
  const { t } = useTranslation(['admin']);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('admin:website.site.navigation')}</CardTitle>
          <CardDescription>{t('admin:website.site.navigationHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {draft.navigation.map((link, index) => (
            <LinkFields
              key={index}
              label={t('admin:website.site.link', { n: index + 1 })}
              link={link}
              optional
              onChange={(next) => {
                onChange({
                  ...draft,
                  navigation: next
                    ? draft.navigation.map((l, i) => (i === index ? next : l))
                    : draft.navigation.filter((_, i) => i !== index),
                });
              }}
            />
          ))}
          {draft.navigation.length < WEBSITE_LIMITS.navigationLinks ? (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                onChange({
                  ...draft,
                  navigation: [...draft.navigation, { label: {}, href: '#contact' }],
                });
              }}
            >
              <Plus aria-hidden className="size-4" />
              {t('admin:website.site.addLink')}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin:website.site.social')}</CardTitle>
          <CardDescription>{t('admin:website.site.socialHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {draft.social.map((link, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <Field label={t('admin:website.site.network')}>
                <NativeSelect
                  value={link.network}
                  onChange={(e) => {
                    const network = SOCIAL_NETWORKS.find((n) => n === e.target.value);
                    if (!network) return;
                    onChange({
                      ...draft,
                      social: draft.social.map((l, i) => (i === index ? { ...l, network } : l)),
                    });
                  }}
                >
                  {SOCIAL_NETWORKS.map((n) => (
                    <option key={n} value={n}>
                      {t(`admin:website.networks.${n}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('admin:website.site.url')} className="min-w-48 flex-1">
                <Input
                  dir="ltr"
                  type="url"
                  placeholder={t('admin:website.site.urlPlaceholder')}
                  value={link.url}
                  onChange={(e) => {
                    onChange({
                      ...draft,
                      social: draft.social.map((l, i) =>
                        i === index ? { ...l, url: e.target.value } : l,
                      ),
                    });
                  }}
                />
              </Field>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('admin:website.site.removeSocial')}
                onClick={() => {
                  onChange({ ...draft, social: draft.social.filter((_, i) => i !== index) });
                }}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          ))}
          {draft.social.length < WEBSITE_LIMITS.socialLinks ? (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                const network: SocialNetwork = 'INSTAGRAM';
                onChange({ ...draft, social: [...draft.social, { network, url: '' }] });
              }}
            >
              <Plus aria-hidden className="size-4" />
              {t('admin:website.site.addSocial')}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t('admin:website.site.seo')}</CardTitle>
          <CardDescription>{t('admin:website.site.seoHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <LocalizedInput
            label={t('admin:website.site.seoTitle')}
            value={draft.seo.title}
            onChange={(title) => {
              onChange({ ...draft, seo: { ...draft.seo, title } });
            }}
          />
          <LocalizedInput
            label={t('admin:website.site.seoDescription')}
            value={draft.seo.description}
            onChange={(description) => {
              onChange({ ...draft, seo: { ...draft.seo, description } });
            }}
          />
          <FilePicker
            kind="WEBSITE_IMAGE"
            label={t('admin:website.site.seoImage')}
            fileId={draft.seo.imageFileId}
            onChange={(imageFileId) => {
              onChange({ ...draft, seo: { ...draft.seo, imageFileId } });
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
