import { watch } from 'vue'
import { createTestingPinia } from '@pinia/testing'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AppearanceSettings from '../../src/renderer/src/components/AppearanceSettings.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { useSettingsStore } from '../../src/renderer/src/stores/settings.js'
import type { RendererSettingsState } from '../../src/shared/types.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'

function snapshot(locale: 'en-US' | 'uk-UA'): RendererSettingsState {
  return {
    settings: {
      theme: 'system',
      interfaceScale: 1.1,
      tabPosition: 'top',
      useSystemTitleBar: false,
      searchEngine: 'google',
      hideInTray: true,
      attentionSound: true,
      attentionSoundCue: 'warning',
      mcpAuthentication: false,
      mcpPort: 47_812,
      mcpToolSet: 'essentials',
      downloadDirectory: null,
      askWhereToSaveDownloads: false,
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: 60,
      checkForUpdatesOnStartup: true,
      languagePreference: locale
    },
    systemTheme: 'light',
    systemLocale: locale,
    resolvedLocale: locale
  }
}

describe('AppearanceSettings', () => {
  it('renders accessible theme controls and switches locale while preserving selector focus', async () => {
    const setLanguagePreference = vi.fn(async () => snapshot('uk-UA'))
    const setTheme = vi.fn(async () => snapshot('en-US').settings)
    Object.defineProperty(window, 'hronautSettings', {
      configurable: true,
      value: { setLanguagePreference, setTheme }
    })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: {
        settings: {
          settings: snapshot('en-US').settings,
          systemTheme: 'light',
          systemLocale: 'en-US',
          resolvedLocale: 'en-US'
        }
      }
    })
    const i18n = createHronautI18n('en-US')
    const store = useSettingsStore(pinia)
    watch(() => store.resolvedLocale, (locale) => { i18n.global.locale.value = locale }, { immediate: true })
    const user = userEvent.setup()
    render(AppearanceSettings, { global: { plugins: [pinia, i18n] } })

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Everyday' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Cinematic' })).toBeVisible()
    expect(screen.getAllByRole('radio')).toHaveLength(9)
    expect(screen.getByRole('radio', { name: /System/ })).toHaveAttribute('aria-checked', 'true')
    const language = screen.getByRole('combobox', { name: 'Interface language' })
    expect(Array.from(language.querySelectorAll('option')).map((option) => option.value)).toEqual(['system', ...SUPPORTED_LOCALES])
    language.focus()
    await user.selectOptions(language, 'uk-UA')

    expect(setLanguagePreference).toHaveBeenCalledWith('uk-UA')
    expect(language).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Тема застосунку' })).toBeVisible()
    expect(document.querySelector('[data-testid="theme-system"]')).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps the authoritative language and shows a localized recoverable error when saving fails', async () => {
    const failure = new Error('disk full')
    Object.defineProperty(window, 'hronautSettings', {
      configurable: true,
      value: { setLanguagePreference: vi.fn().mockRejectedValue(failure) }
    })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    const i18n = createHronautI18n('en-US')
    render(AppearanceSettings, { global: { plugins: [pinia, i18n] } })
    const language = screen.getByRole('combobox', { name: 'Interface language' })
    await userEvent.setup().selectOptions(language, 'uk-UA')

    expect(language).toHaveValue('en-US')
    expect(screen.getByRole('alert')).toHaveTextContent('The language preference could not be saved')
  })

  it('persists a left-side tab position from the appearance panel', async () => {
    const setTabPosition = vi.fn(async () => ({ ...snapshot('en-US').settings, tabPosition: 'left' as const }))
    Object.defineProperty(window, 'hronautSettings', {
      configurable: true,
      value: { setTabPosition }
    })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    render(AppearanceSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })

    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Tab position' }), 'left')

    expect(setTabPosition).toHaveBeenCalledWith('left')
  })

  it('offers the restart-required system title bar fallback without platform filtering', async () => {
    const setUseSystemTitleBar = vi.fn(async () => ({
      ...snapshot('en-US').settings,
      useSystemTitleBar: true
    }))
    Object.defineProperty(window, 'hronautShell', {
      configurable: true,
      value: { windowChrome: { platform: 'darwin', mode: 'overlay', mainWindow: true } }
    })
    Object.defineProperty(window, 'hronautSettings', {
      configurable: true,
      value: { setUseSystemTitleBar }
    })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    render(AppearanceSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })

    const fallback = screen.getByRole('checkbox', { name: /^Use system title bar/ })
    expect(fallback).not.toBeChecked()
    await userEvent.setup().click(fallback)

    expect(setUseSystemTitleBar).toHaveBeenCalledWith(true)
    expect(screen.getByRole('status')).toHaveTextContent('Restart Hronaut to apply this window-frame change.')
  })
})
