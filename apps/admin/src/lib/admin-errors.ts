import { tKey, useErrorText } from '@pos/app-kit';
import { isApiError } from '@pos/api-client';
import { useTranslation } from 'react-i18next';

/**
 * Error text for admin actions: the specific reason the API gave (`details.reason`) when the
 * portal has words for it, otherwise the error code's message. Never shows server internals.
 */
export function useAdminErrorText(): (error: unknown) => string {
  const { t, i18n } = useTranslation('admin');
  const errorText = useErrorText();
  return (error) => {
    const reason = isApiError(error) ? error.details.reason : undefined;
    if (typeof reason === 'string' && i18n.exists(`admin:reasons.${reason}`)) {
      return tKey(t, `admin:reasons.${reason}`);
    }
    return errorText(error);
  };
}
