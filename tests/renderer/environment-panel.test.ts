import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import EnvironmentPanel from '../../src/renderer/src/components/EnvironmentPanel.vue'
import { useEnvironmentPanelController } from '../../src/renderer/src/composables/useEnvironmentPanelController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { browserEnvironmentFromEmulation } from '../../src/shared/browser-environment.js'
import type { BrowserEnvironmentSettings, BrowserState, BrowserTabState } from '../../src/shared/types.js'

function browserState(): BrowserState {
  return {} as BrowserState
}

function browserTab(): BrowserTabState {
  return {
    id: 'tab-1',
    url: 'https://example.test/',
    title: 'Example',
    emulation: { ...browserEnvironmentFromEmulation(), network: 'slow-3g' }
  } as BrowserTabState
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function renderPanel(overrides: {
  setTabEnvironment?: (tabId: string, environment: BrowserEnvironmentSettings) => Promise<BrowserState>
} = {}) {
  const open = ref(true)
  const activeTab = ref<BrowserTabState | undefined>(browserTab())
  let mutation = 0
  const controller = useEnvironmentPanelController({
    open,
    activeTab,
    setTabEnvironment: overrides.setTabEnvironment ?? vi.fn(async () => browserState()),
    reloadIgnoringCache: vi.fn(async () => browserState()),
    syncState: async (operation) => { await operation },
    beginMutation: () => ++mutation,
    isMutationCurrent: (sequence, tabId) => sequence === mutation && activeTab.value?.id === tabId,
    closeTransientPanels: vi.fn()
  })
  const view = render(EnvironmentPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      dock: 'right',
      activeTab: activeTab.value,
      locale: 'en-US',
      controller,
      openResponsivePreview: vi.fn()
    }
  })
  return { view, controller }
}

describe('EnvironmentPanel', () => {
  it('keeps a newer environment draft when an earlier apply finishes', async () => {
    const pending = deferred<BrowserState>()
    const setTabEnvironment = vi.fn(() => pending.promise)
    renderPanel({ setTabEnvironment })
    const user = userEvent.setup()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'offline')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('dialog', { name: 'Environment' })).toHaveAttribute('aria-busy', 'true')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'fast-4g')
    pending.resolve(browserState())
    await vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'Environment' })).toHaveAttribute('aria-busy', 'false'))

    expect(screen.getByRole('combobox', { name: 'Network' })).toHaveValue('fast-4g')
    expect(screen.queryByText('Environment applied')).not.toBeInTheDocument()
  })

  it('prevents invalid geolocation from being submitted', async () => {
    const setTabEnvironment = vi.fn(async () => browserState())
    renderPanel({ setTabEnvironment })
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: /Override geolocation/ }))
    const latitude = screen.getByRole('spinbutton', { name: 'Latitude' })
    await user.clear(latitude)
    await user.type(latitude, '91')

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByText('Check the entered values')).toBeVisible()
    expect(setTabEnvironment).not.toHaveBeenCalled()
  })

  it('emits dock and close model changes', async () => {
    const { view } = renderPanel()
    const user = userEvent.setup()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Dock Environment' }), 'bottom')
    await user.click(screen.getByRole('button', { name: 'Close Environment' }))

    expect(view.emitted()['update:dock']?.at(-1)).toEqual(['bottom'])
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })
})
