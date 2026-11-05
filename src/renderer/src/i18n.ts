import { createI18n, type Composer } from 'vue-i18n'
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../shared/locale.js'
import { pluralFormIndex } from '../../shared/plural.js'
import { loadedLocaleMessages, loadLocaleMessages } from './locale-messages.js'

// vue-i18n picks forms as English does. Each language follows its count's plural category instead: 0 onglet in
// French, and one, few and many in Polish, Russian and Ukrainian: 1 вкладка, 2 вкладки, 5 вкладок, 21 вкладка.
const pluralRule = (locale: SupportedLocale) => (choice: number, choicesLength: number): number => (
  pluralFormIndex(locale, choice, choicesLength)
)

/** The window's i18n in the locale, with the languages it has loaded; one not loaded yet shows English. */
export function createHronautI18n(locale: SupportedLocale) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en-US',
    missingWarn: import.meta.env.DEV,
    fallbackWarn: import.meta.env.DEV,
    messages: Object.fromEntries(SUPPORTED_LOCALES.flatMap((supported) => {
      const messages = loadedLocaleMessages(supported)
      return messages ? [[supported, messages]] : []
    })),
    pluralRules: Object.fromEntries(SUPPORTED_LOCALES.map((supported) => [supported, pluralRule(supported)]))
  })
}

/**
 * Shows the window in a locale once its messages are loaded, and answers the locale shown: English when the messages
 * could not be loaded, and undefined when a later call came meanwhile, as when the person picks another language
 * before the first one arrives. The latest call always wins.
 */
export function createLocaleSwitch(composer: Pick<Composer, 'locale' | 'availableLocales' | 'setLocaleMessage'>) {
  let latest = 0
  return async (locale: SupportedLocale): Promise<SupportedLocale | undefined> => {
    const call = ++latest
    const messages = await loadLocaleMessages(locale)
    if (call !== latest) return undefined
    const shown = messages ? locale : 'en-US'
    if (messages && !composer.availableLocales.includes(locale)) composer.setLocaleMessage(locale, messages)
    composer.locale.value = shown
    return shown
  }
}
