import { watch } from 'vue'
import { createTestingPinia } from '@pinia/testing'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GeneralSettings from '../../src/renderer/src/components/GeneralSettings.vue'
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
      siteSearches: [],
      hideInTray: true,
      launchAtStartup: false,
      launchMinimized: false,
      attentionSound: true,
      attentionSoundCue: 'warning',
      challengeDetectionEnabled: false,
      omitAgentUrlDetail: false,
      allowWebsiteFileSaving: false,
      secureDnsMode: 'automatic',
      secureDnsTemplate: '',
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
      graphicsAcceleration: true,
      checkForUpdatesOnStartup: true,
      languagePreference: locale
    },
    systemTheme: 'light',
    systemLocale: locale,
    resolvedLocale: locale
  }
}

describe('GeneralSettings', () => {
  it('switches locale while keeping focus on the language selector', async () => {
    const setLanguagePreference = vi.fn(async () => snapshot('uk-UA'))
    Object.defineProperty(window, 'hronautSettings', {
      configurable: true,
      value: { setLanguagePreference }
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
    render(GeneralSettings, { global: { plugins: [pinia, i18n] } })

    expect(screen.getByRole('heading', { name: 'General' })).toBeVisible()
    const language = screen.getByRole('combobox', { name: 'Interface language' })
    expect(Array.from(language.querySelectorAll('option')).map((option) => option.value)).toEqual(['system', ...SUPPORTED_LOCALES])
    language.focus()
    await user.selectOptions(language, 'uk-UA')

    expect(setLanguagePreference).toHaveBeenCalledWith('uk-UA')
    expect(language).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Загальні' })).toBeVisible()
  })

  // These rows were in Appearance, so the section for how Hronaut looks also held when it starts and what agents show.
  it('holds the language, startup and tray, and agent activity rows', () => {
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    render(GeneralSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['General', 'Startup and tray', 'Agent activity'])
    expect(screen.getAllByRole('combobox').map((control) => control.getAttribute('aria-label'))).toEqual(['Interface language', 'Attention sound'])
    expect(screen.getAllByRole('checkbox').map((control) => control.id)).toEqual([
      'setting-hide-in-tray',
      'setting-launch-at-startup',
      'setting-launch-minimized',
      'setting-attention-sound',
      'setting-agent-cursor',
      'setting-agent-strip'
    ])
    expect(screen.getByRole('button', { name: 'Test sound' })).toBeEnabled()
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).not.toBeInTheDocument()
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
    render(GeneralSettings, { global: { plugins: [pinia, i18n] } })
    const language = screen.getByRole('combobox', { name: 'Interface language' })
    await userEvent.setup().selectOptions(language, 'uk-UA')

    expect(language).toHaveValue('en-US')
    expect(screen.getByRole('alert')).toHaveTextContent('The language preference could not be saved')
  })

  it('configures startup launch and only enables minimized launch when startup is active', async () => {
    const setLaunchAtStartup = vi.fn(async () => ({
      ...snapshot('en-US').settings,
      launchAtStartup: true
    }))
    const setLaunchMinimized = vi.fn(async () => ({
      ...snapshot('en-US').settings,
      launchAtStartup: true,
      launchMinimized: true
    }))
    Object.defineProperty(window, 'hronautSettings', {
      configurable: true,
      value: { setLaunchAtStartup, setLaunchMinimized }
    })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    render(GeneralSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })
    const user = userEvent.setup()
    const launch = screen.getByRole('checkbox', { name: /^Launch Hronaut when you sign in/ })
    const minimized = screen.getByRole('checkbox', { name: /^Launch minimized/ })

    expect(launch).not.toBeChecked()
    expect(minimized).toBeDisabled()
    await user.click(launch)
    expect(setLaunchAtStartup).toHaveBeenCalledWith(true)
    expect(minimized).toBeEnabled()
    await user.click(minimized)
    expect(setLaunchMinimized).toHaveBeenCalledWith(true)
  })

  it('turns agent cursors on the page off and back on', async () => {
    const setShowAgentCursor = vi.fn(async (showAgentCursor: boolean) => ({ ...snapshot('en-US').settings, showAgentCursor }))
    Object.defineProperty(window, 'hronautSettings', { configurable: true, value: { setShowAgentCursor } })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    render(GeneralSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })

    const cursors = screen.getByRole('checkbox', { name: /^Show agent cursors/ })
    expect(cursors).toBeChecked()
    expect(cursors).toHaveAccessibleName(/where it clicks, points or drags/)
    const user = userEvent.setup()
    await user.click(cursors)
    expect(setShowAgentCursor).toHaveBeenLastCalledWith(false)
    expect(cursors).not.toBeChecked()
    await user.click(cursors)
    expect(setShowAgentCursor).toHaveBeenLastCalledWith(true)
    expect(cursors).toBeChecked()
  })

  it('pins the live status strip and unpins it, off until you choose it', async () => {
    const setPinAgentLiveStatus = vi.fn(async (pinAgentLiveStatus: boolean) => ({ ...snapshot('en-US').settings, pinAgentLiveStatus }))
    Object.defineProperty(window, 'hronautSettings', { configurable: true, value: { setPinAgentLiveStatus } })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    render(GeneralSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })

    const pin = screen.getByRole('checkbox', { name: /^Pin live status below the toolbar/ })
    expect(pin).not.toBeChecked()
    expect(pin).toHaveAccessibleName(/Pages move down to make room/)
    const user = userEvent.setup()
    await user.click(pin)
    expect(setPinAgentLiveStatus).toHaveBeenLastCalledWith(true)
    expect(pin).toBeChecked()
    await user.click(pin)
    expect(setPinAgentLiveStatus).toHaveBeenLastCalledWith(false)
    expect(pin).not.toBeChecked()
  })

  it('has the agent cursor setting and the General section in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createHronautI18n(locale).global
      for (const key of [
        'appearance.agentCursor.label',
        'appearance.agentCursor.description',
        'shell.agentCard.cursor',
        'settings.nav.general',
        'settings.nav.generalDescription',
        'settingsSections.general.heading',
        'settingsSections.general.description'
      ]) {
        expect(i18n.te(key, locale), `${locale} ${key}`).toBe(true)
      }
    }
  })
})
