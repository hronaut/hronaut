import type { PersonNeededWebhookKind } from './types.js'

// What the shell and main both check about the person's webhook before a message goes off the computer.

export const PERSON_NEEDED_WEBHOOK_KINDS: readonly PersonNeededWebhookKind[] = ['slack', 'discord', 'ntfy', 'json']

export function isPersonNeededWebhookKind(value: unknown): value is PersonNeededWebhookKind {
  return typeof value === 'string' && (PERSON_NEEDED_WEBHOOK_KINDS as readonly string[]).includes(value)
}

/** Why an address cannot take the messages: it must be https, or http to this computer only, without a user name. */
export type WebhookAddressProblem = 'too-long' | 'not-an-address' | 'not-https' | 'credentials'

export function webhookAddressProblem(value: string): WebhookAddressProblem | undefined {
  if (value.length > 2_048) return 'too-long'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'not-an-address'
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return 'not-https'
  if (url.username || url.password) return 'credentials'
  return undefined
}
