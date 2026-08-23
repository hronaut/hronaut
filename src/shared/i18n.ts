import type { SupportedLocale } from './locale.js'
import { enUS, type MessageSchema } from './locales/en-US.js'
import { ukUA } from './locales/uk-UA.js'
import { ruRU } from './locales/ru-RU.js'
import { deDE } from './locales/de-DE.js'
import { frFR } from './locales/fr-FR.js'
import { esES } from './locales/es-ES.js'
import { plPL } from './locales/pl-PL.js'

export const localeMessages = {
  'en-US': enUS,
  'uk-UA': ukUA,
  'ru-RU': ruRU,
  'de-DE': deDE,
  'fr-FR': frFR,
  'es-ES': esES,
  'pl-PL': plPL
} satisfies Record<SupportedLocale, MessageSchema>

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

export function translate(
  locale: SupportedLocale,
  key: MessageKey,
  parameters: MessageParameters = {}
): string {
  const template = messageAt(locale, key) ?? messageAt('en-US', key) ?? key
  return template.replace(/\{([A-Za-z][\w]*)\}/g, (_match, name: string) => String(parameters[name] ?? `{${name}}`))
}
