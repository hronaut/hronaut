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
  recoverTabEmulation?: (tabId: string) => Promise<BrowserState>
} = {}) {
  const open = ref(true)
  const activeTab = ref<BrowserTabState | undefined>(browserTab())
  let mutation = 0
  const controller = useEnvironmentPanelController({
    open,
    activeTab,
    recoverTabEmulation: overrides.recoverTabEmulation ?? vi.fn(async () => ({}) as BrowserState),
    setTabEnvironment: overrides.setTabEnvironment ?? vi.fn(async () => browserState()),
    reloadIgnoringCache: vi.fn(async () => browserState()),
    syncState: async (operation) => { await operation },
    beginMutation: () => ++mutation,
    isMutationCurrent: (sequence, tabId) => sequence === mutation && activeTab.value?.id === tabId,
    closeTransientPanels: vi.fn(),
    translate: (key) => key
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
  return { view, controller, activeTab }
}

describe('EnvironmentPanel', () => {
  it('shows retained-state uncertainty and requires explicit restoration before applying a draft', async () => {
    const { activeTab } = renderPanel()
    activeTab.value = { ...activeTab.value!, emulation: undefined, emulationState: { application: 'unknown', retainedSettings: activeTab.value!.emulation!, recovery: 'restore-committed' } }
    await vi.waitFor(() => expect(screen.getAllByText('Emulation unconfirmed')[0]).toBeVisible())
    expect(screen.getByRole('button', { name: /^Apply$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Restore retained settings' })).toBeEnabled()
    activeTab.value.networkConditionState = { application: 'unknown', retainedRules: [] }
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Restore retained settings' })).toBeDisabled())
    expect(screen.getByText(/First recover Network conditions/)).toBeVisible()
  })

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

describe('EnvironmentPanel focus after an action', () => {
  // JSDOM keeps focus on a control that becomes disabled; Chromium moves it to the document body.
  function dropFocusLikeChromium(control: HTMLElement): void {
    control.removeAttribute('disabled')
    control.blur()
    control.setAttribute('disabled', '')
    expect(document.body).toHaveFocus()
  }

  // Apply, Apply & reload and Reset were disabled while the change applied, so Chromium moved the focus of the one you
  // used to the document body, and nothing gave it back: the next Tab started at the top of the window.
  it.each([/^Apply$/, /^Apply & reload$/, /^Reset environment$/])('gives the focus back to %s once the change applies', async (name) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const pending = deferred<BrowserState>()
    const { view } = renderPanel({ setTabEnvironment: vi.fn(() => pending.promise) })
    try {
      const button = screen.getByRole('button', { name })
      await userEvent.setup().click(button)
      expect(button).toBeDisabled()
      dropFocusLikeChromium(button)
      pending.resolve(browserState())
      await vi.waitFor(() => expect(button).toBeEnabled())
      await vi.waitFor(() => expect(button).toHaveFocus())
    } finally {
      view.unmount()
      vi.restoreAllMocks()
    }
  })

  it('leaves newer focus alone when the change applies', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const pending = deferred<BrowserState>()
    const { view } = renderPanel({ setTabEnvironment: vi.fn(() => pending.promise) })
    try {
      const button = screen.getByRole('button', { name: /^Apply$/ })
      await userEvent.setup().click(button)
      dropFocusLikeChromium(button)
      const network = screen.getByRole('combobox', { name: 'Network' })
      network.focus()
      pending.resolve(browserState())
      await vi.waitFor(() => expect(button).toBeEnabled())
      expect(network).toHaveFocus()
    } finally {
      view.unmount()
      vi.restoreAllMocks()
    }
  })
})

it('moves the focus to the first condition once Restore retained settings succeeds and disappears', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const recovering = deferred<BrowserState>()
  const { view, activeTab } = renderPanel({ recoverTabEmulation: vi.fn(() => recovering.promise) })
  const retained = activeTab.value!.emulation!
  activeTab.value = { ...activeTab.value!, emulation: undefined, emulationState: { application: 'unknown', retainedSettings: retained, recovery: 'restore-committed' } }
  try {
    const restore = await screen.findByRole('button', { name: 'Restore retained settings' })
    await vi.waitFor(() => expect(restore).toBeEnabled())
    await userEvent.setup().click(restore)
    expect(restore).toBeDisabled()
    // Recovery confirms the retained settings, so the warning and its Restore button go away with the focus.
    activeTab.value = { ...activeTab.value, emulation: retained, emulationState: undefined }
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Restore retained settings' })).not.toBeInTheDocument())
    expect(document.body).toHaveFocus()
    recovering.resolve(browserState())
    await vi.waitFor(() => expect(screen.getByRole('combobox', { name: 'Network' })).toHaveFocus())
  } finally {
    view.unmount()
    vi.restoreAllMocks()
  }
})
