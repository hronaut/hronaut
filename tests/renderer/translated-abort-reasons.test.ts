import { render } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import NetworkRequestConditions from '../../src/renderer/src/components/NetworkRequestConditions.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { SupportedLocale } from '../../src/shared/locale.js'
import { BROWSER_NETWORK_ABORT_REASONS, type BrowserNetworkRouteSummary } from '../../src/shared/types.js'

function shown(locale: SupportedLocale, routes: BrowserNetworkRouteSummary[]) {
  const view = render(NetworkRequestConditions, {
    global: { plugins: [createHronautI18n(locale)] },
    props: {
      routes, state: 'ready', error: '', locale, expanded: true, mode: 'abort', pattern: '', method: '', times: 1,
      abort: 'BlockedByClient', throttle: 'slow-4g', status: 200, headers: '', body: ''
    }
  })
  try {
    const select = [...view.container.querySelectorAll('select')].find((element) => element.querySelector('option[value="TimedOut"]'))
    return {
      rows: [...view.container.querySelectorAll('.request-condition-copy small')].map((line) => line.textContent?.replace(/\s+/g, ' ').trim()),
      options: [...select?.querySelectorAll('option') ?? []].map((option) => [option.value, option.textContent?.trim()]),
      selected: select?.value
    }
  } finally { view.unmount() }
}

const route = (id: string, abort: string): BrowserNetworkRouteSummary => ({
  enabled: true, id, urlPattern: `https://example.test/${id}`, behavior: 'abort', abort: abort as never, createdAt: '2026-10-21T00:00:00.000Z'
})

describe('request condition failure reasons', () => {
  it('names the failure reasons in the interface language and keeps their codes as values', () => {
    // The list read "Fehlschlagen als TimedOut" and the Failure reason menu listed Chromium's codes.
    const german = shown('de-DE', [route('a', 'TimedOut'), route('b', 'BlockedByClient')])
    expect(german.rows).toEqual(['Beliebige Methode · Fehlschlagen: Zeitüberschreitung · bis zum Entfernen', 'Beliebige Methode · Fehlschlagen: Vom Client blockiert · bis zum Entfernen'])
    expect(german.options.map(([value]) => value)).toEqual([...BROWSER_NETWORK_ABORT_REASONS])
    expect(german.options).toContainEqual(['NameNotResolved', 'Name nicht aufgelöst'])
    expect(german.selected).toBe('BlockedByClient')

    const english = shown('en-US', [route('a', 'ConnectionRefused')])
    expect(english.rows).toEqual(['Any method · Fail: Connection refused · until removed'])
    expect(english.options).toContainEqual(['BlockedByClient', 'Blocked by client'])
  })

  it('names every reason in every locale, and shows one it does not know as its code', () => {
    for (const locale of ['en-US', 'de-DE', 'fr-FR', 'es-ES', 'pl-PL', 'ru-RU', 'uk-UA'] as const) {
      const labels = shown(locale, []).options.map(([, label]) => label)
      expect(new Set(labels).size).toBe(BROWSER_NETWORK_ABORT_REASONS.length)
      // A code is a label only where it is already a word, as English Aborted.
      expect(labels.filter((label) => (BROWSER_NETWORK_ABORT_REASONS as readonly string[]).includes(label ?? ''))).toEqual(locale === 'en-US' ? ['Aborted'] : [])
    }
    expect(shown('de-DE', [route('a', 'FutureReason'), route('b', 'constructor')]).rows)
      .toEqual(['Beliebige Methode · Fehlschlagen: FutureReason · bis zum Entfernen', 'Beliebige Methode · Fehlschlagen: constructor · bis zum Entfernen'])
  })
})
