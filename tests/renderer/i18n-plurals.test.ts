import { describe, expect, it } from 'vitest'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { localeMessages } from '../../src/shared/i18n.js'
import type { SupportedLocale } from '../../src/shared/locale.js'
import { pluralFormIndex } from '../../src/shared/plural.js'

const COUNTS = [0, 1, 2, 5, 11, 12, 21, 22, 25]

// The shell passes the count formatted for display and the number that picks the form, as the app does.
function tabs(locale: SupportedLocale): string[] {
  const t = createHronautI18n(locale).global.t as (key: string, named: Record<string, unknown>, plural: number) => string
  return COUNTS.map((count) => t('workspaceSwitcher.tabs', { count: String(count) }, count))
}

function pluralMessages(value: unknown, path: string[] = [], found: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === 'string') {
    if (value.includes(' | ')) found.push([path.join('.'), value])
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) pluralMessages(child, [...path, key], found)
  }
  return found
}

describe('plural forms', () => {
  it('picks the one, few and many forms in Polish, Russian and Ukrainian', () => {
    expect(tabs('ru-RU')).toEqual([
      '0 вкладок', '1 вкладка', '2 вкладки', '5 вкладок', '11 вкладок', '12 вкладок', '21 вкладка', '22 вкладки', '25 вкладок'
    ])
    expect(tabs('uk-UA')).toEqual([
      '0 вкладок', '1 вкладка', '2 вкладки', '5 вкладок', '11 вкладок', '12 вкладок', '21 вкладка', '22 вкладки', '25 вкладок'
    ])
    expect(tabs('pl-PL')).toEqual([
      '0 kart', '1 karta', '2 karty', '5 kart', '11 kart', '12 kart', '21 kart', '22 karty', '25 kart'
    ])
  })

  it('keeps one and other in the other languages, each by its own rule', () => {
    expect(tabs('en-US')).toEqual(['0 tabs', '1 tab', '2 tabs', '5 tabs', '11 tabs', '12 tabs', '21 tabs', '22 tabs', '25 tabs'])
    expect(tabs('de-DE').slice(0, 3)).toEqual(['0 Tabs', '1 Tab', '2 Tabs'])
    // French counts 0 as one, as it does 1; it read "0 onglets".
    expect(tabs('fr-FR').slice(0, 3)).toEqual(['0 onglet', '1 onglet', '2 onglets'])
    expect(tabs('es-ES').slice(0, 3)).toEqual(['0 pestañas', '1 pestaña', '2 pestañas'])
  })

  it('gives every plural message the forms its language picks from', () => {
    // Chinese, Japanese, Korean, Indonesian and Vietnamese write a count the same way whatever it is, so their messages
    // have one form.
    const forms: Record<SupportedLocale, number> = {
      'en-US': 2, 'de-DE': 2, 'es-ES': 2, 'fr-FR': 2, 'pl-PL': 3, 'ru-RU': 3, 'uk-UA': 3,
      'it-IT': 2, 'pt-BR': 2, 'tr-TR': 2, 'hi-IN': 2, 'ja-JP': 1, 'ko-KR': 1, 'zh-CN': 1, 'zh-TW': 1, 'id-ID': 1, 'vi-VN': 1
    }
    for (const [locale, expected] of Object.entries(forms) as Array<[SupportedLocale, number]>) {
      const messages = pluralMessages(localeMessages[locale])
      if (expected > 1) expect(messages.length, locale).toBeGreaterThan(0)
      expect(messages.filter(([, message]) => message.split(' | ').length !== expected).map(([key]) => `${locale} ${key}`)).toEqual([])
    }
  })

  it('chooses a form for Home and the shell alike', () => {
    expect(COUNTS.map((count) => pluralFormIndex('ru-RU', count, 3))).toEqual([2, 0, 1, 2, 2, 2, 0, 1, 2])
    expect(COUNTS.map((count) => pluralFormIndex('pl-PL', count, 3))).toEqual([2, 0, 1, 2, 2, 2, 2, 1, 2])
    expect(COUNTS.map((count) => pluralFormIndex('en-US', count, 2))).toEqual([1, 0, 1, 1, 1, 1, 1, 1, 1])
    expect(COUNTS.map((count) => pluralFormIndex('fr-FR', count, 2))).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1])
    expect(pluralFormIndex('ru-RU', 5, 1)).toBe(0)
    expect(COUNTS.map((count) => pluralFormIndex('ja-JP', count, 1))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})
