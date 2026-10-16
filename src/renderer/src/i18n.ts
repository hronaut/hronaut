import { createI18n } from 'vue-i18n'
import { localeMessages } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'
import { pluralFormIndex } from '../../shared/plural.js'

// vue-i18n picks forms as English does. Polish, Russian and Ukrainian strings give one, few and many forms, which
// follow the count's plural category instead: 1 вкладка, 2 вкладки, 5 вкладок, 21 вкладка.
const slavicPlural = (locale: SupportedLocale) => (choice: number, choicesLength: number): number => (
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
    pluralRules: { 'pl-PL': slavicPlural('pl-PL'), 'ru-RU': slavicPlural('ru-RU'), 'uk-UA': slavicPlural('uk-UA') }
  })
}
