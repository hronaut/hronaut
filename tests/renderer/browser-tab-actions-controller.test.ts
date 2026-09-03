import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useBrowserTabActionsController } from '../../src/renderer/src/composables/useBrowserTabActionsController.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'active',
    title: 'Active page',
    url: 'https://example.test/',
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...overrides
  }
}

function browserState(active: BrowserTabState = tab()): BrowserState {
  return {
    tabs: [active],
    closedTabs: [],
    activeTabId: active.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/tmp/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function deferred<Value>() {
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((_resolve, fail) => {
    reject = fail
  })
  return { promise, reject }
}

function createHarness() {
  const active = tab()
  const state = ref(browserState(active))
  const activeTab = ref<BrowserTabState | undefined>(active)
  const home = ref(false)
  const browser = {
    closeTab: vi.fn(async (_tabId: string) => state.value),
    navigate: vi.fn(async (_options: { url: string; tabId?: string }) => state.value),
    reload: vi.fn(async (_tabId?: string) => state.value),
    reorderTab: vi.fn(async (_tabId: string, _targetTabId: string, _placement: 'before' | 'after') => state.value),
    selectTab: vi.fn(async (_tabId: string) => state.value),
    setAllHumanInteractionLocked: vi.fn(async (_locked: boolean) => state.value),
    setTabHumanInteractionLocked: vi.fn(async (_tabId: string, _locked: boolean) => state.value),
    setTabMuted: vi.fn(async (_tabId: string, _muted: boolean) => state.value),
    showWorkspaceContextMenu: vi.fn(async (_groupId: string) => undefined),
    toggleDevTools: vi.fn(async (_tabId?: string) => true)
  }
  const syncState = vi.fn(async (operation: Promise<BrowserState> | BrowserState) => {
    state.value = await operation
  })
  const onSelectError = vi.fn()
  const onNavigateError = vi.fn()
  const beforeToggleDeveloperTools = vi.fn()
  const controller = useBrowserTabActionsController({
    state,
    activeTab,
    isHome: () => home.value,
    browser,
    syncState,
    beforeToggleDeveloperTools,
    onSelectError,
    onNavigateError
  })
  return {
    state,
    activeTab,
    home,
    browser,
    syncState,
    beforeToggleDeveloperTools,
    onSelectError,
    onNavigateError,
    controller
  }
}

describe('browser tab actions controller', () => {
  it('contains selection and navigation failures at their action-specific boundaries', async () => {
    const harness = createHarness()
    const selectionFailure = new Error('selection failed')
    const navigationFailure = new Error('navigation failed')
    harness.browser.selectTab.mockRejectedValueOnce(selectionFailure)
    harness.browser.navigate.mockRejectedValueOnce(navigationFailure)

    await expect(harness.controller.selectBrowserTab('other')).resolves.toBe(false)
    await expect(harness.controller.navigateAddress('https://next.test/')).resolves.toBeUndefined()

    expect(harness.onSelectError).toHaveBeenCalledWith(selectionFailure)
    expect(harness.onNavigateError).toHaveBeenCalledWith(navigationFailure)
  })

  it('ignores a superseded navigation failure while preserving the newest failure', async () => {
    const harness = createHarness()
    let rejectFirstNavigation: ((error: Error) => void) | undefined
    let resolveSecondNavigation: ((state: BrowserState) => void) | undefined
    const firstNavigation = new Promise<BrowserState>((_resolve, reject) => {
      rejectFirstNavigation = reject
    })
    const secondNavigation = new Promise<BrowserState>((resolve) => {
      resolveSecondNavigation = resolve
    })
    harness.browser.navigate
      .mockReturnValueOnce(firstNavigation)
      .mockReturnValueOnce(secondNavigation)

    const superseded = harness.controller.navigateAddress('https://slow.test/')
    const newest = harness.controller.navigateAddress('https://fast.test/')
    resolveSecondNavigation?.(harness.state.value)
    await newest
    rejectFirstNavigation?.(new Error('ERR_ABORTED'))
    await superseded

    expect(harness.onNavigateError).not.toHaveBeenCalled()

    const newestFailure = new Error('ERR_CONNECTION_REFUSED')
    harness.browser.navigate.mockRejectedValueOnce(newestFailure)
    await harness.controller.navigateAddress('https://failed.test/')
    expect(harness.onNavigateError).toHaveBeenCalledOnce()
    expect(harness.onNavigateError).toHaveBeenCalledWith(newestFailure)
  })

  it('ignores a delayed navigation failure after disposal', async () => {
    const harness = createHarness()
    const pending = deferred<BrowserState>()
    harness.browser.navigate.mockReturnValueOnce(pending.promise)

    const navigation = harness.controller.navigateAddress('https://slow.test/')
    const dispose = (harness.controller as typeof harness.controller & { dispose?: () => void }).dispose
    dispose?.()
    pending.reject(new Error('late navigation failure'))
    await navigation

    expect(dispose).toBeTypeOf('function')
    expect(harness.onNavigateError).not.toHaveBeenCalled()
  })

  it('targets the current tab for navigation and page-problem retry', async () => {
    const harness = createHarness()
    await harness.controller.navigateAddress('https://next.test/')
    await harness.controller.retryActivePageProblem()
    expect(harness.browser.navigate).toHaveBeenCalledWith({ url: 'https://next.test/', tabId: 'active' })
    expect(harness.browser.reload).not.toHaveBeenCalled()

    harness.activeTab.value = tab({ pageProblem: {
      kind: 'load-error',
      title: 'Unavailable',
      message: 'Try again',
      url: 'https://example.test/'
    } })
    await harness.controller.retryActivePageProblem()
    expect(harness.browser.reload).toHaveBeenCalledWith('active')
  })

  it('preserves global and Home interaction guards', async () => {
    const harness = createHarness()
    harness.state.value = { ...harness.state.value, allHumanInteractionLocked: true }
    await harness.controller.closeTab('active')
    await harness.controller.toggleTabHumanInteraction()
    expect(harness.browser.closeTab).not.toHaveBeenCalled()
    expect(harness.browser.setTabHumanInteractionLocked).not.toHaveBeenCalled()

    harness.state.value = { ...harness.state.value, allHumanInteractionLocked: false }
    harness.home.value = true
    await harness.controller.toggleTabHumanInteraction()
    expect(harness.browser.setTabHumanInteractionLocked).not.toHaveBeenCalled()
  })

  it('delegates workspace, ordering, mute, and interaction mutations with inverted state', async () => {
    const harness = createHarness()
    const mutedTab = tab({ muted: true })
    harness.state.value = browserState(mutedTab)
    harness.activeTab.value = mutedTab
    await harness.controller.showWorkspaceContextMenu('workspace')
    await harness.controller.reorderTab({ tabId: 'first', targetTabId: 'second', placement: 'after' })
    await harness.controller.toggleTabMuted(mutedTab)
    await harness.controller.toggleTabHumanInteraction()
    await harness.controller.toggleAllHumanInteraction()

    expect(harness.browser.showWorkspaceContextMenu).toHaveBeenCalledWith('workspace')
    expect(harness.browser.reorderTab).toHaveBeenCalledWith('first', 'second', 'after')
    expect(harness.browser.setTabMuted).toHaveBeenCalledWith('active', false)
    expect(harness.browser.setTabHumanInteractionLocked).toHaveBeenCalledWith('active', true)
    expect(harness.browser.setAllHumanInteractionLocked).toHaveBeenCalledWith(true)
  })

  it('serializes rapid mute toggles against the latest authoritative tab state', async () => {
    const harness = createHarness()
    harness.browser.setTabMuted.mockImplementation(async (tabId, muted) => ({
      ...harness.state.value,
      tabs: harness.state.value.tabs.map((candidate) => candidate.id === tabId ? { ...candidate, muted } : candidate)
    }))

    await Promise.all([
      harness.controller.toggleTabMuted(tab()),
      harness.controller.toggleTabMuted(tab())
    ])

    expect(harness.browser.setTabMuted.mock.calls.map(([, muted]) => muted)).toEqual([true, false])
    expect(harness.state.value.tabs[0]?.muted).toBe(false)
  })

  it('keeps a toggle queue usable after an earlier mutation is rejected', async () => {
    const harness = createHarness()
    const failure = new Error('mute unavailable')
    harness.browser.setTabMuted
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(async (tabId, muted) => ({
        ...harness.state.value,
        tabs: harness.state.value.tabs.map((candidate) => candidate.id === tabId ? { ...candidate, muted } : candidate)
      }))

    const first = harness.controller.toggleTabMuted(tab())
    const second = harness.controller.toggleTabMuted(tab())

    await expect(first).rejects.toBe(failure)
    await expect(second).resolves.toBeUndefined()
    expect(harness.browser.setTabMuted.mock.calls.map(([, muted]) => muted)).toEqual([true, true])
    expect(harness.state.value.tabs[0]?.muted).toBe(true)
  })

  it('serializes rapid per-tab and global interaction-lock toggles', async () => {
    const harness = createHarness()
    harness.browser.setTabHumanInteractionLocked.mockImplementation(async (tabId, locked) => ({
      ...harness.state.value,
      tabs: harness.state.value.tabs.map((candidate) => candidate.id === tabId
        ? { ...candidate, humanInteractionLocked: locked }
        : candidate)
    }))
    harness.browser.setAllHumanInteractionLocked.mockImplementation(async (locked) => ({
      ...harness.state.value,
      allHumanInteractionLocked: locked
    }))

    await Promise.all([
      harness.controller.toggleTabHumanInteraction(),
      harness.controller.toggleTabHumanInteraction()
    ])
    await Promise.all([
      harness.controller.toggleAllHumanInteraction(),
      harness.controller.toggleAllHumanInteraction()
    ])

    expect(harness.browser.setTabHumanInteractionLocked.mock.calls.map(([, locked]) => locked)).toEqual([true, false])
    expect(harness.browser.setAllHumanInteractionLocked.mock.calls.map(([locked]) => locked)).toEqual([true, false])
    expect(harness.state.value.tabs[0]?.humanInteractionLocked).toBe(false)
    expect(harness.state.value.allHumanInteractionLocked).toBe(false)
  })

  it('owns guarded Developer Tools toggles and shell cleanup outside App.vue', async () => {
    const harness = createHarness()

    harness.home.value = true
    await harness.controller.toggleDeveloperTools()
    harness.home.value = false
    harness.activeTab.value = tab({ humanInteractionLocked: true })
    await harness.controller.toggleDeveloperTools()
    expect(harness.browser.toggleDevTools).not.toHaveBeenCalled()
    expect(harness.beforeToggleDeveloperTools).not.toHaveBeenCalled()

    harness.activeTab.value = tab()
    await harness.controller.toggleDeveloperTools()
    expect(harness.beforeToggleDeveloperTools).toHaveBeenCalledOnce()
    expect(harness.browser.toggleDevTools).toHaveBeenCalledWith('active')
  })

  it('preserves shell panels when global interaction lock blocks Developer Tools', async () => {
    const harness = createHarness()
    harness.state.value = { ...harness.state.value, allHumanInteractionLocked: true }

    await harness.controller.toggleDeveloperTools()

    expect(harness.beforeToggleDeveloperTools).not.toHaveBeenCalled()
    expect(harness.browser.toggleDevTools).not.toHaveBeenCalled()
  })
})
