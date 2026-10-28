import type { I18nResources } from '@pos/i18n';

export { setupReactI18n as setupI18n } from '@pos/app-kit';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: I18nResources;
  }
}
