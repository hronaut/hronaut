import type { SupportedLocale } from './locale.js'
import { enUS, type MessageSchema } from './locales/en-US.js'
import { ukUA } from './locales/uk-UA.js'
import { ruRU } from './locales/ru-RU.js'
import { deDE } from './locales/de-DE.js'
import { frFR } from './locales/fr-FR.js'
import { esES } from './locales/es-ES.js'
import { plPL } from './locales/pl-PL.js'
import { itIT } from './locales/it-IT.js'
import { ptBR } from './locales/pt-BR.js'
import { trTR } from './locales/tr-TR.js'
import { hiIN } from './locales/hi-IN.js'
import { jaJP } from './locales/ja-JP.js'
import { koKR } from './locales/ko-KR.js'
import { zhCN } from './locales/zh-CN.js'
import { zhTW } from './locales/zh-TW.js'
import { idID } from './locales/id-ID.js'
import { viVN } from './locales/vi-VN.js'
import { translateFrom, type MessageKey, type MessageParameters } from './translate.js'

// Every language at once, as main speaks whichever one the person chose. A renderer window loads only the one it shows
// (src/renderer/src/locale-messages.ts) and never imports this module.
// Annotated rather than inferred: seventeen catalogs' inferred types are more than the compiler will write out.
export const localeMessages: Record<SupportedLocale, MessageSchema> = {
  'en-US': enUS,
  'uk-UA': ukUA,
  'ru-RU': ruRU,
  'de-DE': deDE,
  'fr-FR': frFR,
  'es-ES': esES,
  'pl-PL': plPL,
  'it-IT': itIT,
  'pt-BR': ptBR,
  'tr-TR': trTR,
  'hi-IN': hiIN,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'id-ID': idID,
  'vi-VN': viVN
}

export type { MessageKey, MessageParameters } from './translate.js'

/**
 * The message for the locale, or English when the locale has none, with its placeholders filled in. A message with
 * plural forms ("{count} account | {count} accounts") takes the form the locale uses for a numeric `count`.
 */
export function translate(
  locale: SupportedLocale,
  key: MessageKey,
  parameters: MessageParameters = {}
): string {
  return translateFrom(localeMessages[locale], enUS, locale, key, parameters)
}
