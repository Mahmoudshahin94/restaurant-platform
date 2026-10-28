import { useTranslation } from 'react-i18next';

const json = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * An audit entry's details. Repairs and configuration changes carry `before` and `after`, shown
 * side by side; everything else as it was recorded (already redacted by the server).
 */
export function AuditDetails({ metadata }: { metadata: Record<string, unknown> }) {
  const { t } = useTranslation('platform');
  const { before, after, ...rest } = metadata;
  const hasDiff = before !== undefined || after !== undefined;
  return (
    <div className="grid gap-3" dir="ltr">
      {hasDiff ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold" dir="auto">
              {t('audit.before')}
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {json(before ?? null)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold" dir="auto">
              {t('audit.after')}
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {json(after ?? null)}
            </pre>
          </div>
        </div>
      ) : null}
      {Object.keys(rest).length > 0 ? (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{json(rest)}</pre>
      ) : null}
    </div>
  );
}
