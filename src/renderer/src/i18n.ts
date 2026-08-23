import { createI18n } from 'vue-i18n'
import { localeMessages } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'

export function createHronautI18n(locale: SupportedLocale) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en-US',
    missingWarn: import.meta.env.DEV,
    fallbackWarn: import.meta.env.DEV,
    messages: localeMessages
  })
}
