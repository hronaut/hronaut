import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PerformanceSettingsPanel from '../../src/renderer/src/components/PerformanceSettingsPanel.vue'
import { usePerformanceSettingsController } from '../../src/renderer/src/composables/usePerformanceSettingsController.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AppSettings, BrowserState, MemorySaverTimeoutMinutes, SupportedLocale } from '../../src/shared/types.js'

function browserState(): BrowserState {
  const tab = (id: string, sleeping: boolean) => ({
    id, title: id, url: `https://${id}.test`, loading: false, navigationGeneration: 0, canGoBack: false, canGoForward: false,
    active: id === 'second', pinned: false, sleeping, humanInteractionLocked: false, preserveDiagnosticLogs: false,
    zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
  })
  return {
    tabs: [tab('first', true), tab('second', false)],
    closedTabs: [], activeTabId: 'second', allHumanInteractionLocked: false,
    mcpUrl: '', profilePath: '/profile', mcpTabGroups: [], savedTabGroups: []
  }
}

function deferred<Value>() {
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((_resolve, fail) => { reject = fail })
  return { promise, reject }
}

function renderPanel(locale: SupportedLocale = 'en-US') {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const state = ref(browserState())
  const setEnabled = vi.fn(async () => settings.value)
  const setTimeout = vi.fn(async (_minutes: MemorySaverTimeoutMinutes) => settings.value)
  const sleepInactiveTabs = vi.fn(async () => state.value)
  const controller = usePerformanceSettingsController({
    settings,
    browserState: state,
    setEnabled,
    setTimeout,
    resetSettings: async () => settings.value,
    sleepInactiveTabs,
    syncBrowserState: async (operation) => operation,
    formatError: (error) => error instanceof Error ? error.message : String(error),
    onError: vi.fn()
  })
  render(PerformanceSettingsPanel, {
    global: { plugins: [createHronautI18n(locale)] },
    props: { controller, formatNumber: (value: number) => String(value) }
  })
  return { controller, state, setEnabled, setTimeout, sleepInactiveTabs }
}

describe('PerformanceSettingsPanel', () => {
  it('renders live sleeping-tab counts and localized timeout choices', () => {
    const { controller } = renderPanel()

    expect(screen.getByRole('heading', { name: 'Memory Saver' })).toBeVisible()
    expect(screen.getByText('1 sleeping')).toBeVisible()
    expect(screen.getByText('of 2 website tabs')).toBeVisible()
    expect(screen.getByRole('combobox', { name: /^Sleep after/ })).toHaveValue('60')
    expect(screen.getByRole('option', { name: '2 hours' })).toBeVisible()
    controller.dispose()
  })

  it('counts sleeping and website tabs in the form each number takes', async () => {
    // Each count had one word for every number: "1 сплять" and "of 1 website tabs".
    const ukrainian = renderPanel('uk-UA')
    expect(screen.getByText('1 спить')).toBeVisible()
    expect(screen.getByText('із 2 вкладок сайтів')).toBeVisible()
    ukrainian.controller.dispose()
    document.body.replaceChildren()

    const english = renderPanel()
    english.state.value = { ...english.state.value, tabs: english.state.value.tabs.slice(0, 1) }
    expect(await screen.findByText('of 1 website tab')).toBeVisible()
    expect(screen.getByText('1 sleeping')).toBeVisible()
    english.controller.dispose()
  })

  // With every website tab already asleep, Sleep eligible tabs now stayed available and did nothing.
  it('offers sleeping tabs now only while a website tab is awake', async () => {
    const { state } = renderPanel()
    const sleep = screen.getByRole('button', { name: 'Sleep eligible tabs now' })
    expect(sleep).toBeEnabled()

    state.value = { ...state.value, tabs: state.value.tabs.map((tab) => ({ ...tab, sleeping: true })) }
    await vi.waitFor(() => expect(sleep).toBeDisabled())
  })

  it('disables all actions while saving and restores the timeout after failure', async () => {
    const saving = deferred<AppSettings>()
    const { controller, setTimeout } = renderPanel()
    setTimeout.mockImplementationOnce(() => saving.promise)
    const user = userEvent.setup()
    const timeout = screen.getByRole('combobox', { name: /^Sleep after/ })
    const enabled = screen.getByRole('checkbox', { name: /^Automatically sleep inactive tabs/ })
    const sleep = screen.getByRole('button', { name: 'Sleep eligible tabs now' })

    await user.selectOptions(timeout, '15')
    expect(timeout).toBeDisabled()
    expect(enabled).toBeDisabled()
    expect(sleep).toBeDisabled()

    saving.reject(new Error('cannot persist memory saver'))
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot persist memory saver')
    expect(timeout).toHaveValue('60')
    expect(timeout).not.toBeDisabled()
    controller.dispose()
  })
})

describe('PerformanceSettingsPanel focus after a change', () => {
  // JSDOM keeps focus on a control that becomes disabled; Chromium moves it to the document body.
  function dropFocusLikeChromium(control: HTMLElement): void {
    control.removeAttribute('disabled')
    control.blur()
    control.setAttribute('disabled', '')
    expect(document.body).toHaveFocus()
  }

  function pending<Value>() {
    let resolve!: (value: Value) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail })
    return { promise, resolve, reject }
  }

  // Every Memory Saver control was disabled while one change saved, so Chromium moved the focus of the one you used to
  // the document body and nothing gave it back: an arrow key on Sleep after saved one choice and the next one did nothing.
  it.each(['is saved', 'fails'] as const)('gives the focus back to Sleep after once the change %s', async (outcome) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const saving = pending<AppSettings>()
    const { controller, setTimeout } = renderPanel()
    setTimeout.mockImplementationOnce(() => saving.promise)
    try {
      const timeout = screen.getByRole('combobox', { name: /^Sleep after/ })
      await userEvent.setup().selectOptions(timeout, '15')
      expect(timeout).toBeDisabled()
      dropFocusLikeChromium(timeout)
      if (outcome === 'fails') saving.reject(new Error('cannot persist memory saver'))
      else saving.resolve({ ...DEFAULT_RENDERER_SETTINGS, memorySaverTimeoutMinutes: 15 })
      await vi.waitFor(() => expect(timeout).toBeEnabled())
      await vi.waitFor(() => expect(timeout).toHaveFocus())
    } finally {
      vi.restoreAllMocks()
      controller.dispose()
    }
  })

  it.each([
    ['checkbox', /^Automatically sleep inactive tabs/],
    ['button', /^Sleep eligible tabs now/]
  ] as const)('gives the focus back to the %s %s once its action settles', async (role, name) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { controller, setEnabled, sleepInactiveTabs } = renderPanel()
    const action = pending<never>()
    if (role === 'checkbox') setEnabled.mockImplementationOnce(() => action.promise)
    else sleepInactiveTabs.mockImplementationOnce(() => action.promise)
    try {
      const control = screen.getByRole(role, { name })
      await userEvent.setup().click(control)
      expect(control).toBeDisabled()
      dropFocusLikeChromium(control)
      action.reject(new Error('refused'))
      await vi.waitFor(() => expect(control).toBeEnabled())
      await vi.waitFor(() => expect(control).toHaveFocus())
    } finally {
      vi.restoreAllMocks()
      controller.dispose()
    }
  })
})
