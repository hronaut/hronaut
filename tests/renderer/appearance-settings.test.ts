import { createTestingPinia } from '@pinia/testing'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AppearanceSettings from '../../src/renderer/src/components/AppearanceSettings.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { RendererSettingsState } from '../../src/shared/types.js'

function snapshot(locale: 'en-US' | 'uk-UA'): RendererSettingsState {
  return {
    settings: {
      theme: 'system',
      interfaceScale: 1.1,
      tabPosition: 'top',
      useSystemTitleBar: false,
      searchEngine: 'google',
      siteSearches: [],
      hideInTray: true,
      launchAtStartup: false,
      launchMinimized: false,
      attentionSound: true,
      attentionSoundCue: 'warning',
      challengeDetectionEnabled: false,
      omitAgentUrlDetail: false,
      allowWebsiteFileSaving: false,
      followAgentActivity: false,
      showAgentCursor: true,
      pinAgentLiveStatus: false,
      mcpRemoteAccess: false,
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
  it('uses roving focus and arrow keys across the theme radio group', async () => {
    const setTheme = vi.fn(async (theme: RendererSettingsState['settings']['theme']) => ({
      ...snapshot('en-US').settings,
      theme
    }))
    Object.defineProperty(window, 'hronautSettings', {
      configurable: true,
      value: { setTheme }
    })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    render(AppearanceSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })

    const system = screen.getByRole('radio', { name: /System/ })
    const light = screen.getByRole('radio', { name: /^Light/ })
    const galactic = screen.getByRole('radio', { name: /^Galactic/ })
    expect(system).toHaveAttribute('tabindex', '0')
    for (const radio of screen.getAllByRole('radio').filter((candidate) => candidate !== system)) {
      expect(radio).toHaveAttribute('tabindex', '-1')
    }

    system.focus()
    await userEvent.setup().keyboard('{ArrowRight}')

    expect(setTheme).toHaveBeenCalledWith('light')
    expect(light).toHaveFocus()
    expect(light).toHaveAttribute('aria-checked', 'true')

    await userEvent.setup().keyboard('{Home}')
    expect(system).toHaveFocus()
    await userEvent.setup().keyboard('{End}')
    expect(galactic).toHaveFocus()
    await userEvent.setup().keyboard('{ArrowRight}')
    expect(system).toHaveFocus()
    expect(setTheme.mock.calls.map(([theme]) => theme)).toEqual(['light', 'system', 'galactic', 'system'])
    // With Alt, Ctrl or Cmd these keys are the browser's: Alt+Home chose the first theme instead of opening Home.
    for (const modifiers of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      for (const key of ['Home', 'End', 'ArrowRight']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
        system.dispatchEvent(event)
        expect(event.defaultPrevented, key).toBe(false)
      }
    }
    expect(system).toHaveFocus()
    expect(setTheme).toHaveBeenCalledTimes(4)
  })

  it('renders accessible theme controls', () => {
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    render(AppearanceSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Everyday' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Cinematic' })).toBeVisible()
    expect(screen.getAllByRole('radio')).toHaveLength(10)
    expect(screen.getByRole('radio', { name: /System/ })).toHaveAttribute('aria-checked', 'true')
  })

  // Appearance also held the language, startup and tray, and agent activity rows, which now live in General.
  it('keeps only how Hronaut looks', () => {
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    render(AppearanceSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })

    expect(screen.getAllByRole('combobox').map((control) => control.getAttribute('aria-label'))).toEqual(['Interface size', 'Tab position'])
    expect(screen.getAllByRole('checkbox').map((control) => control.id)).toEqual(['setting-system-title-bar'])
    expect(screen.queryByRole('button', { name: 'Test sound' })).not.toBeInTheDocument()
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
