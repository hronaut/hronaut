import { describe, expect, it } from 'vitest'
import { translate, type MessageKey } from '../src/shared/i18n.js'
import { SUPPORTED_LOCALES } from '../src/shared/locale.js'

// Settings explained a missing Linux keyring with "basic_text" and "Argon2id", and agents with "browser_navigate" and
// "MCP tabs", words people who are not developers of Hronaut do not know.
const PLAIN_COPY: MessageKey[] = [
  'settings.search.description',
  'settings.downloads.help',
  'settings.memory.help',
  'settings.support.unavailable',
  'native.errors.linuxSecrets',
  'wallets.backends.passphrase',
  'wallets.createPassphraseDescription'
] as MessageKey[]

describe('settings copy', () => {
  it.each(SUPPORTED_LOCALES)('names no internals in %s', (locale) => {
    for (const key of PLAIN_COPY) {
      const text = translate(locale, key)
      expect(text, `${locale} ${key}`).not.toBe(key)
      expect(text, `${locale} ${key}`).not.toMatch(/browser_navigate|basic.text|Argon2id|\bMCP\b|backend|human dialog|для людини/i)
    }
  })
})
