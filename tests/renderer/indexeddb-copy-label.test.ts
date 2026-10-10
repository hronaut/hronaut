import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import SiteStorageIndexedDbView from '../../src/renderer/src/components/SiteStorageIndexedDbView.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserIndexedDbReport, SupportedLocale } from '../../src/shared/types.js'

const report: BrowserIndexedDbReport = {
  tabId: 'tab-1', url: 'https://example.test', origin: 'https://example.test',
  databases: [{ name: 'app', version: 1 }],
  selectedDatabase: { name: 'app', version: 1, objectStores: [
    { name: 'settings', keyPath: 'id', autoIncrement: false, indexes: [], entryCount: 2 }
  ] },
  selectedObjectStore: 'settings', offset: 0, limit: 50, hasMore: false, valuesIncluded: true, caveats: [],
  entries: [
    { key: 'theme', primaryKey: 'theme', keyType: 'String', valueType: 'Object', valuePreview: 'dark' },
    { key: 'language', primaryKey: 'language', keyType: 'String', valueType: 'Object', valuePreview: 'en-CA' }
  ]
}

function renderView(locale: SupportedLocale = 'en-US') {
  return render(SiteStorageIndexedDbView, {
    global: { plugins: [createHronautI18n(locale)] },
    props: {
      state: 'idle', report, error: '', copied: false, entries: report.entries.slice(0, 1),
      offset: 0, locale, database: 'app', store: 'settings', search: 'theme'
    }
  })
}

describe('IndexedDB copy scope label', () => {
  it.each<[SupportedLocale, string]>([
    ['en-US', 'Copy filtered'], ['uk-UA', 'Копіювати відфільтроване'],
    ['de-DE', 'Gefilterte kopieren'], ['fr-FR', 'Copier les résultats filtrés'],
    ['es-ES', 'Copiar resultados filtrados'], ['pl-PL', 'Kopiuj przefiltrowane'],
    ['ru-RU', 'Копировать отфильтрованное']
  ])('names the filtered copy scope in %s', (locale, label) => {
    renderView(locale)
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
  })

  it('uses loaded scope for blank search and delegates the same copy action', async () => {
    const view = renderView()
    await view.rerender({ search: ' \t ', entries: report.entries })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy loaded' }))
    expect(view.emitted().copy).toEqual([[]])
    await view.rerender({ search: 'theme', entries: report.entries.slice(0, 1) })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy filtered' }))
    expect(view.emitted().copy).toEqual([[], []])
  })

  it('preserves copied feedback and loading disablement for the filtered action', async () => {
    const view = renderView()
    await view.rerender({ copied: true })
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
    await view.rerender({ copied: false, state: 'loading' })
    expect(screen.getByRole('button', { name: 'Copy filtered' })).toBeDisabled()
  })
})
