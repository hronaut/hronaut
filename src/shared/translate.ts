import type { SupportedLocale } from './locale.js'
import type { MessageSchema } from './locales/en-US.js'
import { pluralFormIndex } from './plural.js'

// How a message is looked up and filled in, apart from the catalogs: main has every language at hand, while each
// renderer window loads only the one it shows (src/renderer/src/locale-messages.ts).

type LeafKeys<Value, Prefix extends string = ''> = {
  [Key in keyof Value & string]: Value[Key] extends string
    ? `${Prefix}${Key}`
    : Value[Key] extends Record<string, unknown>
      ? LeafKeys<Value[Key], `${Prefix}${Key}.`>
      : never
}[keyof Value & string]

export type MessageKey = LeafKeys<MessageSchema>
export type MessageParameters = Record<string, string | number>

function messageAt(messages: MessageSchema | undefined, key: MessageKey): string | undefined {
  let value: unknown = messages
  for (const segment of key.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return typeof value === 'string' ? value : undefined
}

/**
 * The message from the locale's catalog, or from English when the catalog has none or is not at hand, with its
 * placeholders filled in. A message with plural forms ("{count} account | {count} accounts") takes the form its own
 * language uses for a numeric `count`: English's for an English message.
 */
export function translateFrom(
  messages: MessageSchema | undefined,
  english: MessageSchema,
  locale: SupportedLocale,
  key: MessageKey,
  parameters: MessageParameters = {}
): string {
  const own = messageAt(messages, key)
  let template = own ?? messageAt(english, key) ?? key
  if (typeof parameters.count === 'number' && template.includes(' | ')) {
    const forms = template.split(' | ')
    template = forms[pluralFormIndex(own === undefined ? 'en-US' : locale, parameters.count, forms.length)] ?? forms[0]!
  }
  return template.replace(/\{([A-Za-z][\w]*)\}/g, (_match, name: string) => String(parameters[name] ?? `{${name}}`))
}
