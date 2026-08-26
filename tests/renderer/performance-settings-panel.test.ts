import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PerformanceSettingsPanel from '../../src/renderer/src/components/PerformanceSettingsPanel.vue'
import { usePerformanceSettingsController } from '../../src/renderer/src/composables/usePerformanceSettingsController.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AppSettings, BrowserState, MemorySaverTimeoutMinutes } from '../../src/shared/types.js'

function browserState(): BrowserState {
  const tab = (id: string, sleeping: boolean) => ({
    id, title: id, url: `https://${id}.test`, loading: false, canGoBack: false, canGoForward: false,
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

function renderPanel() {
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
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller, formatNumber: (value: number) => String(value) }
  })
  return { controller, setEnabled, setTimeout, sleepInactiveTabs }
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
