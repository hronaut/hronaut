import type { SupportedLocale } from '../../shared/locale.js'
import { enUS, type MessageSchema } from '../../shared/locales/en-US.js'
import { translateFrom, type MessageKey, type MessageParameters } from '../../shared/translate.js'

// English is part of each window's own code, as every message falls back to it. Every other language is a chunk of its
// own, loaded the first time a window shows it, so a window holds English and the language it shows rather than all
// seventeen: they took 6 MB of script for the shell and each overlay to parse and keep.
const LANGUAGES: Record<Exclude<SupportedLocale, 'en-US'>, () => Promise<MessageSchema>> = {
  'uk-UA': async () => (await import('../../shared/locales/uk-UA.js')).ukUA,
  'ru-RU': async () => (await import('../../shared/locales/ru-RU.js')).ruRU,
  'de-DE': async () => (await import('../../shared/locales/de-DE.js')).deDE,
  'fr-FR': async () => (await import('../../shared/locales/fr-FR.js')).frFR,
  'es-ES': async () => (await import('../../shared/locales/es-ES.js')).esES,
  'pl-PL': async () => (await import('../../shared/locales/pl-PL.js')).plPL,
  'it-IT': async () => (await import('../../shared/locales/it-IT.js')).itIT,
  'pt-BR': async () => (await import('../../shared/locales/pt-BR.js')).ptBR,
  'tr-TR': async () => (await import('../../shared/locales/tr-TR.js')).trTR,
  'hi-IN': async () => (await import('../../shared/locales/hi-IN.js')).hiIN,
  'ja-JP': async () => (await import('../../shared/locales/ja-JP.js')).jaJP,
  'ko-KR': async () => (await import('../../shared/locales/ko-KR.js')).koKR,
  'zh-CN': async () => (await import('../../shared/locales/zh-CN.js')).zhCN,
  'zh-TW': async () => (await import('../../shared/locales/zh-TW.js')).zhTW,
  'id-ID': async () => (await import('../../shared/locales/id-ID.js')).idID,
  'vi-VN': async () => (await import('../../shared/locales/vi-VN.js')).viVN
}

const loaded = new Map<SupportedLocale, MessageSchema>([['en-US', enUS]])
const loading = new Map<SupportedLocale, Promise<MessageSchema | undefined>>()

/**
 * The language's messages, loaded once for the window. Undefined when they could not be loaded, as from a damaged
 * install; the window then shows English, and does not try that language again.
 */
export function loadLocaleMessages(locale: SupportedLocale): Promise<MessageSchema | undefined> {
  const messages = loaded.get(locale)
  if (messages) return Promise.resolve(messages)
  let pending = loading.get(locale)
  if (!pending) {
    pending = LANGUAGES[locale as Exclude<SupportedLocale, 'en-US'>]().then((messages) => {
      loaded.set(locale, messages)
      return messages
    }, () => {
      // The error names the chunk's path on this computer, which stays out of the console.
      console.warn(`[i18n] The ${locale} messages could not be loaded; this window shows English instead.`)
      return undefined
    })
    loading.set(locale, pending)
  }
  return pending
}

/** The language's messages if this window has loaded them. */
export function loadedLocaleMessages(locale: SupportedLocale): MessageSchema | undefined {
  return loaded.get(locale)
}

/**
 * The message in the locale, or in English when the locale has none or this window has not loaded it, with its
 * placeholders and plural form filled in as main's `translate` does.
 */
export function translate(locale: SupportedLocale, key: MessageKey, parameters: MessageParameters = {}): string {
  return translateFrom(loaded.get(locale), enUS, locale, key, parameters)
}
