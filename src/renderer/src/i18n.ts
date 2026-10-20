import { createI18n } from 'vue-i18n'
import { localeMessages } from '../../shared/i18n.js'
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../shared/locale.js'
import { pluralFormIndex } from '../../shared/plural.js'

// vue-i18n picks forms as English does. Each language follows its count's plural category instead: 0 onglet in
// French, and one, few and many in Polish, Russian and Ukrainian: 1 вкладка, 2 вкладки, 5 вкладок, 21 вкладка.
const pluralRule = (locale: SupportedLocale) => (choice: number, choicesLength: number): number => (
  pluralFormIndex(locale, choice, choicesLength)
)

export function createHronautI18n(locale: SupportedLocale) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en-US',
    missingWarn: import.meta.env.DEV,
    fallbackWarn: import.meta.env.DEV,
    messages: localeMessages,
    pluralRules: Object.fromEntries(SUPPORTED_LOCALES.map((supported) => [supported, pluralRule(supported)]))
  })
}
