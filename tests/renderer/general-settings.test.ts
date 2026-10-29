import { watch } from 'vue'
import { createTestingPinia } from '@pinia/testing'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GeneralSettings from '../../src/renderer/src/features/settings/GeneralSettings.vue'
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
      languagePreference: locale,
      spellCheck: true,
      spellCheckLanguages: []
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
      'setting-spell-check',
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

  it('turns spell check off and on, and keeps the switch as it was when the change fails', async () => {
    let fail = false
    const setSpellCheck = vi.fn(async (spellCheck: boolean) => {
      if (fail) throw new Error('disk full')
      return { ...snapshot('en-US').settings, spellCheck }
    })
    Object.defineProperty(window, 'hronautSettings', { configurable: true, value: { setSpellCheck } })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    const rendered = render(GeneralSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })

    const spelling = screen.getByRole('checkbox', { name: /^Spell check/ })
    expect(spelling).toBeChecked()
    expect(spelling).toHaveAccessibleName(/Check for spelling errors when you type text on websites/)
    const user = userEvent.setup()
    await user.click(spelling)
    expect(setSpellCheck).toHaveBeenLastCalledWith(false)
    expect(spelling).not.toBeChecked()
    fail = true
    await user.click(spelling)
    expect(setSpellCheck).toHaveBeenLastCalledWith(true)
    await vi.waitFor(() => expect(spelling).not.toBeChecked())
    expect(rendered.emitted().settingError).toHaveLength(1)
  })

  it('lists the spell check languages, adds one and removes one, keeping at least one', async () => {
    let fail = false
    const setSpellCheckLanguages = vi.fn(async (spellCheckLanguages: string[]) => {
      if (fail) throw new Error('disk full')
      return { ...snapshot('en-US').settings, spellCheckLanguages }
    })
    const getSpellCheckLanguages = vi.fn(async () => ({ available: ['de', 'en-GB', 'en-US', 'uk'], automatic: ['en-US'] }))
    Object.defineProperty(window, 'hronautSettings', { configurable: true, value: { getSpellCheckLanguages, setSpellCheckLanguages } })
    const pinia = createTestingPinia({
      stubActions: false,
      createSpy: vi.fn,
      initialState: { settings: { ...snapshot('en-US'), settings: snapshot('en-US').settings } }
    })
    const rendered = render(GeneralSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })
    const list = await screen.findByRole('list', { name: 'Spell check languages' })
    const languages = () => Array.from(list.querySelectorAll('li')).map((item) => item.textContent?.trim())

    // None chosen: the automatic language, which cannot be removed while it is the only one.
    expect(languages()).toEqual(['American English'])
    const removeAmerican = screen.getByRole('button', { name: 'Remove American English' })
    expect(removeAmerican).toHaveAttribute('aria-disabled', 'true')
    const user = userEvent.setup()
    await user.click(removeAmerican)
    expect(setSpellCheckLanguages).not.toHaveBeenCalled()

    const add = screen.getByRole('combobox', { name: 'Add language' })
    expect(Array.from(add.querySelectorAll('option')).map((option) => option.textContent)).toEqual(['Add language', 'British English', 'German', 'Ukrainian'])
    await user.selectOptions(add, 'uk')
    expect(setSpellCheckLanguages).toHaveBeenLastCalledWith(['en-US', 'uk'])
    await vi.waitFor(() => expect(languages()).toEqual(['American English', 'Ukrainian']))
    expect(add).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Remove American English' }))
    expect(setSpellCheckLanguages).toHaveBeenLastCalledWith(['uk'])
    await vi.waitFor(() => expect(languages()).toEqual(['Ukrainian']))
    // Focus stays with the list, not on another language's button a held Enter would press.
    await vi.waitFor(() => expect(list).toHaveFocus())

    fail = true
    await user.selectOptions(add, 'de')
    expect(setSpellCheckLanguages).toHaveBeenLastCalledWith(['uk', 'de'])
    await vi.waitFor(() => expect(rendered.emitted().settingError).toHaveLength(1))
    expect(languages()).toEqual(['Ukrainian'])
  })

  it('names the languages in the interface language, starting with a capital', async () => {
    const getSpellCheckLanguages = vi.fn(async () => ({ available: ['en-US', 'uk'], automatic: ['uk'] }))
    Object.defineProperty(window, 'hronautSettings', { configurable: true, value: { getSpellCheckLanguages } })
    const pinia = createTestingPinia({ stubActions: false, createSpy: vi.fn, initialState: { settings: snapshot('uk-UA') } })
    render(GeneralSettings, { global: { plugins: [pinia, createHronautI18n('uk-UA')] } })
    const list = await screen.findByRole('list', { name: 'Мови перевірки правопису' })
    expect(list.querySelector('li')?.textContent?.trim()).toBe('Українська')
    expect(screen.getByRole('button', { name: 'Видалити мову: Українська' })).toBeInTheDocument()
  })

  it('cannot change the spell check languages while spell check is off', async () => {
    const getSpellCheckLanguages = vi.fn(async () => ({ available: ['en-US', 'uk'], automatic: ['en-US'] }))
    const setSpellCheckLanguages = vi.fn()
    Object.defineProperty(window, 'hronautSettings', { configurable: true, value: { getSpellCheckLanguages, setSpellCheckLanguages } })
    const settings = { ...snapshot('en-US').settings, spellCheck: false, spellCheckLanguages: ['uk', 'en-US'] }
    const pinia = createTestingPinia({ stubActions: false, createSpy: vi.fn, initialState: { settings: { ...snapshot('en-US'), settings } } })
    render(GeneralSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })
    expect(await screen.findByRole('combobox', { name: 'Add language' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove Ukrainian' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Remove American English' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove Ukrainian' }))
    expect(setSpellCheckLanguages).not.toHaveBeenCalled()
  })

  it('shows no spell check languages where the system picks them, as on macOS, or when main cannot list them', async () => {
    for (const getSpellCheckLanguages of [vi.fn(async () => ({ available: [], automatic: [] })), vi.fn(async () => { throw new Error('gone') })]) {
      Object.defineProperty(window, 'hronautSettings', { configurable: true, value: { getSpellCheckLanguages } })
      const pinia = createTestingPinia({ stubActions: false, createSpy: vi.fn, initialState: { settings: snapshot('en-US') } })
      const rendered = render(GeneralSettings, { global: { plugins: [pinia, createHronautI18n('en-US')] } })
      await vi.waitFor(() => expect(getSpellCheckLanguages).toHaveBeenCalledOnce())
      await Promise.resolve()
      expect(screen.queryByRole('list', { name: 'Spell check languages' })).toBeNull()
      expect(screen.queryByRole('combobox', { name: 'Add language' })).toBeNull()
      expect(screen.getByRole('checkbox', { name: /^Spell check/ })).toBeVisible()
      rendered.unmount()
    }
  })

  it('has the agent cursor setting and the General section in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createHronautI18n(locale).global
      for (const key of [
        'appearance.agentCursor.label',
        'appearance.agentCursor.description',
        'appearance.spellCheck.label',
        'appearance.spellCheck.description',
        'native.context.spellCheck',
        'native.context.checkSpelling',
        'native.context.spellCheckLanguageSettings',
        'appearance.spellCheckLanguages.label',
        'appearance.spellCheckLanguages.description',
        'appearance.spellCheckLanguages.add',
        'appearance.spellCheckLanguages.remove',
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
