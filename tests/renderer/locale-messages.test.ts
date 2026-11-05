import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { useI18n } from 'vue-i18n'

// The setup file loads every language for the component tests; these start from a window that has loaded none.
async function freshWindow() {
  vi.resetModules()
  const messages = await import('../../src/renderer/src/locale-messages.js')
  const i18n = await import('../../src/renderer/src/i18n.js')
  return { ...messages, ...i18n }
}

/** A module that loads once `release` is called, as a language's chunk does over a slow disk. */
function heldLanguage(path: string) {
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  vi.doMock(path, async () => {
    await released
    return vi.importActual(path)
  })
  return () => release()
}

afterEach(() => {
  vi.doUnmock('../../src/shared/locales/fr-FR.js')
  vi.doUnmock('../../src/shared/locales/de-DE.js')
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('the languages a renderer window loads', () => {
  it('holds only English until a language is loaded, and loads each language once', async () => {
    const { loadLocaleMessages, loadedLocaleMessages, translate } = await freshWindow()
    expect(loadedLocaleMessages('en-US')?.addressOverlay.localOnly).toBe('Local only')
    expect(loadedLocaleMessages('de-DE')).toBeUndefined()
    expect(translate('de-DE', 'addressOverlay.localOnly')).toBe('Local only')

    const [first, second] = await Promise.all([loadLocaleMessages('de-DE'), loadLocaleMessages('de-DE')])
    expect(first).toBe(second)
    expect(first?.addressOverlay.localOnly).toBe('Nur lokal')
    expect(await loadLocaleMessages('de-DE')).toBe(first)
    expect(translate('de-DE', 'addressOverlay.localOnly')).toBe('Nur lokal')
    expect(translate('de-DE', 'addressOverlay.historyVisits', { count: 2 })).toBe('Verlauf · 2 Besuche')
    expect(loadedLocaleMessages('fr-FR')).toBeUndefined()
  })

  it('shows English when a language cannot be loaded, without naming the chunk, and does not try it again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let attempts = 0
    vi.doMock('../../src/shared/locales/fr-FR.js', () => {
      attempts += 1
      throw new Error('Failed to fetch dynamically imported module: file:///home/person/hronaut/assets/fr-FR.js')
    })
    const { loadLocaleMessages, translate } = await freshWindow()
    expect(await loadLocaleMessages('fr-FR')).toBeUndefined()
    expect(await loadLocaleMessages('fr-FR')).toBeUndefined()
    expect(attempts).toBe(1)
    expect(translate('fr-FR', 'addressOverlay.localOnly')).toBe('Local only')
    // The English text takes English's plural form: French would take the singular for none.
    expect(translate('fr-FR', 'addressOverlay.historyVisits', { count: 0 })).toBe('History · 0 visits')
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toBe('[i18n] The fr-FR messages could not be loaded; this window shows English instead.')
  })
})

describe('a language Hronaut does not have', () => {
  it('shows English, as one that cannot be loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { loadLocaleMessages, translate } = await freshWindow()
    const unknown = 'xx-XX' as 'de-DE'
    expect(await loadLocaleMessages(unknown)).toBeUndefined()
    expect(translate(unknown, 'addressOverlay.localOnly')).toBe('Local only')
  })
})

describe('switching a window to another language', () => {
  async function mounted(locale: 'en-US') {
    const window = await freshWindow()
    const i18n = window.createHronautI18n(locale)
    let label = () => ''
    const app = createApp(defineComponent(() => {
      const { t } = useI18n()
      label = () => t('addressOverlay.localOnly')
      return () => h('span', label())
    }))
    app.use(i18n)
    app.mount(document.createElement('div'))
    return { ...window, i18n, label: () => label(), unmount: () => app.unmount() }
  }

  it('shows the language once its messages are loaded', async () => {
    const { i18n, createLocaleSwitch, label, unmount } = await mounted('en-US')
    const switchLocale = createLocaleSwitch(i18n.global)
    const switching = switchLocale('de-DE')
    expect(i18n.global.locale.value).toBe('en-US')
    expect(await switching).toBe('de-DE')
    expect(i18n.global.locale.value).toBe('de-DE')
    expect(label()).toBe('Nur lokal')
    unmount()
  })

  it('keeps the language chosen last when an earlier one arrives late', async () => {
    const releaseFrench = heldLanguage('../../src/shared/locales/fr-FR.js')
    const { i18n, createLocaleSwitch, label, unmount } = await mounted('en-US')
    const switchLocale = createLocaleSwitch(i18n.global)
    const french = switchLocale('fr-FR')
    try {
      expect(await switchLocale('de-DE')).toBe('de-DE')
    } finally {
      releaseFrench()
    }
    expect(await french).toBeUndefined()
    expect(i18n.global.locale.value).toBe('de-DE')
    expect(label()).toBe('Nur lokal')
    unmount()
  })

  it('shows English when the language cannot be loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.doMock('../../src/shared/locales/de-DE.js', () => { throw new Error('missing') })
    const { i18n, createLocaleSwitch, label, unmount } = await mounted('en-US')
    expect(await createLocaleSwitch(i18n.global)('de-DE')).toBe('en-US')
    expect(i18n.global.locale.value).toBe('en-US')
    expect(label()).toBe('Local only')
    unmount()
  })
})
