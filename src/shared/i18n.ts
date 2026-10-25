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
import { pluralFormIndex } from './plural.js'

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

type LeafKeys<Value, Prefix extends string = ''> = {
  [Key in keyof Value & string]: Value[Key] extends string
    ? `${Prefix}${Key}`
    : Value[Key] extends Record<string, unknown>
      ? LeafKeys<Value[Key], `${Prefix}${Key}.`>
      : never
}[keyof Value & string]

export type MessageKey = LeafKeys<MessageSchema>
export type MessageParameters = Record<string, string | number>

function messageAt(locale: SupportedLocale, key: MessageKey): string | undefined {
  let value: unknown = localeMessages[locale]
  for (const segment of key.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return typeof value === 'string' ? value : undefined
}

/**
 * The message for the locale, or English when the locale has none, with its placeholders filled in. A message with
 * plural forms ("{count} account | {count} accounts") takes the form the locale uses for a numeric `count`.
 */
export function translate(
  locale: SupportedLocale,
  key: MessageKey,
  parameters: MessageParameters = {}
): string {
  let template = messageAt(locale, key) ?? messageAt('en-US', key) ?? key
  if (typeof parameters.count === 'number' && template.includes(' | ')) {
    const forms = template.split(' | ')
    template = forms[pluralFormIndex(locale, parameters.count, forms.length)] ?? forms[0]!
  }
  return template.replace(/\{([A-Za-z][\w]*)\}/g, (_match, name: string) => String(parameters[name] ?? `{${name}}`))
}
