import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useBrowserShortcutController } from '../../src/renderer/src/composables/useBrowserShortcutController.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string, active = false): BrowserTabState {
  return {
    id,
    url: `https://${id}.test/`,
    title: id,
    active,
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false
  }
}

function browserState(activeTabId: string | null = 'second'): BrowserState {
  return {
    tabs: [tab('first'), tab('second', activeTabId === 'second'), tab('third')],
    closedTabs: [],
    activeTabId,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/tmp/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function createController(canRunAction = (_action: string) => true) {
  const state = ref(browserState())
  const activeTab = ref<BrowserTabState | undefined>(state.value.tabs[1])
  const browser = {
    closeTab: vi.fn(async (_tabId: string) => state.value),
    reopenClosedTab: vi.fn(async (_closedTabId?: string) => state.value),
    selectTab: vi.fn(async (_tabId: string) => state.value),
    reload: vi.fn(async (_tabId?: string) => state.value),
    reloadIgnoringCache: vi.fn(async (_tabId?: string) => state.value),
    newTab: vi.fn(async (_options?: { mcpGroupId?: string; active?: boolean }) => state.value),
    // Main's move, as reorderTab makes it: the tab goes just before or after the target.
    focusActivePage: vi.fn(async () => undefined),
    reorderTab: vi.fn(async (tabId: string, targetTabId: string, placement: 'before' | 'after') => {
      const moving = state.value.tabs.find((candidate) => candidate.id === tabId)!
      const rest = state.value.tabs.filter((candidate) => candidate.id !== tabId)
      rest.splice(rest.findIndex((candidate) => candidate.id === targetTabId) + (placement === 'after' ? 1 : 0), 0, moving)
      state.value = { ...state.value, tabs: rest }
      return state.value
    })
  }
  const syncState = vi.fn(async (operation: Promise<BrowserState> | BrowserState) => { await operation })
  const settingsOpen = ref(false)
  const settingsTabOpen = ref(false)
  const callbacks = {
    openSettings: vi.fn(() => { settingsOpen.value = true }),
    closeSettingsTab: vi.fn(() => { settingsOpen.value = false; settingsTabOpen.value = false }),
    openNewTab: vi.fn(async () => undefined),
    focusAddress: vi.fn(async () => undefined),
    openFind: vi.fn(async () => undefined),
    findAgain: vi.fn(async (_again: 'next' | 'previous') => undefined),
    setZoom: vi.fn(async () => undefined),
    toggleCurrentBookmark: vi.fn(async () => undefined),
    toggleVisitHistory: vi.fn(async () => undefined),
    toggleDownloads: vi.fn(async () => undefined),
    toggleTabSearch: vi.fn(async () => undefined),
    openPrivacySettings: vi.fn(async () => undefined),
    toggleCommandPalette: vi.fn(async () => undefined),
    toggleElementPicker: vi.fn(async () => undefined),
    toggleDeveloperTools: vi.fn(async () => undefined),
    openAgentCard: vi.fn(async () => undefined),
    toggleFullPageView: vi.fn(async () => undefined),
    takeOverFromAgent: vi.fn(async () => undefined),
    toggleWorkspaceSwitcher: vi.fn(async () => undefined),
    onError: vi.fn()
  }
  const controller = useBrowserShortcutController({
    state,
    activeTab,
    browser,
    syncState,
    settingsOpen,
    settingsTabOpen,
    canRunAction,
    ...callbacks
  })
  return { state, activeTab, browser, syncState, settingsOpen, settingsTabOpen, callbacks, controller }
}

describe('browser shortcut controller', () => {
  it('moves the tab in view one place with Ctrl+Shift+Page Down and Page Up, staying at either end, as Chrome does', async () => {
    const { state, browser, syncState, controller } = createController()
    const order = () => state.value.tabs.map((candidate) => candidate.id)
    // Each press moves the tab from where the one before left it.
    await Promise.all([controller.run('move-tab-next'), controller.run('move-tab-next')])
    expect(order()).toEqual(['first', 'third', 'second'])
    expect(browser.reorderTab).toHaveBeenCalledTimes(1)
    expect(browser.reorderTab).toHaveBeenCalledWith('second', 'third', 'after')
    await controller.run('move-tab-previous')
    await controller.run('move-tab-previous')
    expect(order()).toEqual(['second', 'first', 'third'])
    expect(browser.reorderTab).toHaveBeenLastCalledWith('second', 'first', 'before')
    await controller.run('move-tab-previous')
    expect(browser.reorderTab).toHaveBeenCalledTimes(3)
    expect(syncState).toHaveBeenCalledTimes(3)
    // The tab never leaves the selection: it stays the one in view.
    expect(browser.selectTab).not.toHaveBeenCalled()
  })

  it('moves a tab only among its own workspace\'s tabs on its side of the pinned ones', async () => {
    const { state, activeTab, browser, controller } = createController()
    const at = (id: string, changes: Partial<BrowserTabState>) => ({ ...state.value.tabs.find((candidate) => candidate.id === id)!, ...changes })
    state.value = {
      ...state.value,
      tabs: [
        { ...tab('home'), url: 'hronaut://home/' },
        at('first', { pinned: true, mcpGroupId: 'work' }),
        at('second', { mcpGroupId: 'work' }),
        { ...tab('other'), mcpGroupId: 'personal' },
        at('third', { mcpGroupId: 'work' })
      ]
    }
    activeTab.value = state.value.tabs.find((candidate) => candidate.id === 'second')
    // Past the pinned tab before it there is nowhere to go; the next one of its workspace is past the other workspace's.
    await controller.run('move-tab-previous')
    expect(browser.reorderTab).not.toHaveBeenCalled()
    await controller.run('move-tab-next')
    expect(browser.reorderTab).toHaveBeenCalledExactlyOnceWith('second', 'third', 'after')
    // Hronaut Home stays where it is.
    activeTab.value = state.value.tabs[0]
    await controller.run('move-tab-next')
    expect(browser.reorderTab).toHaveBeenCalledOnce()
  })

  it('gives the keyboard to the page with F6 from Hronaut\'s window, but not while Settings covers it', async () => {
    const { browser, settingsOpen, callbacks, controller } = createController()
    expect(await controller.run('focus-next-pane')).toBe(true)
    expect(browser.focusActivePage).toHaveBeenCalledOnce()
    expect(callbacks.focusAddress).not.toHaveBeenCalled()
    settingsOpen.value = true
    expect(await controller.run('focus-next-pane')).toBe(false)
    expect(browser.focusActivePage).toHaveBeenCalledOnce()
  })

  it('moves no tab while Settings is in view', async () => {
    const { browser, settingsOpen, controller } = createController()
    settingsOpen.value = true
    expect(await controller.run('move-tab-next')).toBe(false)
    expect(browser.reorderTab).not.toHaveBeenCalled()
  })

  it('moves no tab when Settings comes into view while earlier tab changes run', async () => {
    const { browser, settingsOpen, controller } = createController()
    const selection = deferred<BrowserState>()
    browser.selectTab.mockReturnValueOnce(selection.promise)
    const selecting = controller.run('next-tab')
    const moving = controller.run('move-tab-next')
    // The press was for the website in view; Settings now covers it.
    settingsOpen.value = true
    selection.resolve(browserState('third'))
    await selecting
    await moving
    expect(browser.reorderTab).not.toHaveBeenCalled()
  })

  it('closes Settings without closing the underlying website', async () => {
    const harness = createController()
    harness.settingsOpen.value = true
    harness.settingsTabOpen.value = true
    await expect(harness.controller.run('close-tab')).resolves.toBe(true)
    expect(harness.callbacks.closeSettingsTab).toHaveBeenCalledOnce()
    expect(harness.browser.closeTab).not.toHaveBeenCalled()
    expect(harness.settingsTabOpen.value).toBe(false)
  })

  it('includes Settings in relative tab navigation and preserves it when switching away', async () => {
    const harness = createController()
    harness.settingsTabOpen.value = true
    harness.state.value.activeTabId = 'first'
    await harness.controller.selectRelativeTab(1)
    expect(harness.callbacks.openSettings).toHaveBeenCalledOnce()
    expect(harness.settingsOpen.value).toBe(true)
    await harness.controller.selectRelativeTab(1)
    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.settingsTabOpen.value).toBe(true)
    expect(harness.browser.selectTab).toHaveBeenCalledWith('second')
  })

  // Ctrl+J, or Cmd+Option+L on macOS, did nothing: the View menu's Downloads now asks for the downloads panel.
  it('opens or closes the downloads panel, also while Settings is open', async () => {
    const harness = createController()
    await expect(harness.controller.run('downloads')).resolves.toBe(true)
    harness.settingsOpen.value = true
    await expect(harness.controller.run('downloads')).resolves.toBe(true)
    expect(harness.callbacks.toggleDownloads).toHaveBeenCalledTimes(2)
  })

  it('does not reload the hidden website while Settings is active', async () => {
    const harness = createController()
    harness.settingsOpen.value = true
    await expect(harness.controller.run('reload')).resolves.toBe(false)
    expect(harness.browser.reload).not.toHaveBeenCalled()
  })

  it('keeps a denied native page action from running behind modal presentation', async () => {
    const canRunAction = vi.fn((action: string) => action !== 'pick-element')
    const harness = createController(canRunAction)

    await expect(harness.controller.run('pick-element')).resolves.toBe(false)
    await expect(harness.controller.run('new-tab')).resolves.toBe(true)

    expect(canRunAction).toHaveBeenNthCalledWith(1, 'pick-element')
    expect(canRunAction).toHaveBeenNthCalledWith(2, 'new-tab')
    expect(harness.callbacks.toggleElementPicker).not.toHaveBeenCalled()
    expect(harness.callbacks.openNewTab).toHaveBeenCalledOnce()
    expect(harness.callbacks.onError).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('goes to the next and previous match of Find from their shortcuts, but not under Settings', async () => {
    const harness = createController()
    await expect(harness.controller.run('find-next')).resolves.toBe(true)
    expect(harness.callbacks.findAgain).toHaveBeenLastCalledWith('next')
    await expect(harness.controller.run('find-previous')).resolves.toBe(true)
    expect(harness.callbacks.findAgain).toHaveBeenLastCalledWith('previous')
    harness.settingsOpen.value = true
    await expect(harness.controller.run('find-next')).resolves.toBe(false)
    await expect(harness.controller.run('find-previous')).resolves.toBe(false)
    expect(harness.callbacks.findAgain).toHaveBeenCalledTimes(2)
  })

  it('opens the agent card from its shortcut, but not over Settings', async () => {
    const harness = createController()
    await expect(harness.controller.run('agent-card')).resolves.toBe(true)
    expect(harness.callbacks.openAgentCard).toHaveBeenCalledOnce()
    harness.settingsOpen.value = true
    await expect(harness.controller.run('agent-card')).resolves.toBe(false)
    expect(harness.callbacks.openAgentCard).toHaveBeenCalledOnce()
  })

  it('toggles the full-page view from its shortcut, but not under Settings', async () => {
    const harness = createController()
    await expect(harness.controller.run('toggle-full-page')).resolves.toBe(true)
    expect(harness.callbacks.toggleFullPageView).toHaveBeenCalledOnce()
    harness.settingsOpen.value = true
    await expect(harness.controller.run('toggle-full-page')).resolves.toBe(false)
    expect(harness.callbacks.toggleFullPageView).toHaveBeenCalledOnce()
  })

  it('takes over from the agent from its shortcut, but not under Settings', async () => {
    const harness = createController()
    await expect(harness.controller.run('take-over')).resolves.toBe(true)
    expect(harness.callbacks.takeOverFromAgent).toHaveBeenCalledOnce()
    harness.settingsOpen.value = true
    await expect(harness.controller.run('take-over')).resolves.toBe(false)
    expect(harness.callbacks.takeOverFromAgent).toHaveBeenCalledOnce()
  })

  it('opens the workspace switcher from its shortcut, even from Settings, which the switcher closes', async () => {
    const harness = createController()
    await expect(harness.controller.run('switch-workspace')).resolves.toBe(true)
    harness.settingsOpen.value = true
    await expect(harness.controller.run('switch-workspace')).resolves.toBe(true)
    expect(harness.callbacks.toggleWorkspaceSwitcher).toHaveBeenCalledTimes(2)
    expect(harness.callbacks.toggleCommandPalette).not.toHaveBeenCalled()
  })

  it('reports rejected browser operations instead of leaking an unhandled shortcut failure', async () => {
    const harness = createController()
    const failure = new Error('reload channel unavailable')
    harness.browser.reload.mockRejectedValueOnce(failure)

    await expect(harness.controller.run('reload')).resolves.toBe(false)

    expect(harness.browser.reload).toHaveBeenCalledWith('second')
    expect(harness.callbacks.onError).toHaveBeenCalledWith('reload', failure)
    harness.controller.dispose()
  })

  it('delegates new-tab creation to the shell navigation controller', async () => {
    const harness = createController()

    await expect(harness.controller.run('new-tab')).resolves.toBe(true)

    expect(harness.callbacks.openNewTab).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('wraps relative tab selection and ignores a stale active-tab id', async () => {
    const harness = createController()

    await harness.controller.selectRelativeTab(1)
    await harness.controller.selectRelativeTab(-1)
    expect(harness.browser.selectTab).toHaveBeenNthCalledWith(1, 'third')
    expect(harness.browser.selectTab).toHaveBeenNthCalledWith(2, 'first')

    harness.state.value = browserState('missing')
    await harness.controller.selectRelativeTab(1)
    expect(harness.browser.selectTab).toHaveBeenCalledTimes(2)
    harness.controller.dispose()
  })

  it('selects numbered website tabs without counting Home and uses 9 for the last tab', async () => {
    const harness = createController()
    const home = { ...tab('home'), url: 'hronaut://home/' }
    const websites = Array.from({ length: 9 }, (_, index) => tab(`website-${index + 1}`, index === 1))
    harness.state.value = {
      ...browserState('website-2'),
      tabs: [home, ...websites]
    }

    await expect(harness.controller.run('select-tab-1')).resolves.toBe(true)
    await expect(harness.controller.run('select-tab-8')).resolves.toBe(true)
    await expect(harness.controller.run('select-last-tab')).resolves.toBe(true)

    expect(harness.browser.selectTab).toHaveBeenNthCalledWith(1, 'website-1')
    expect(harness.browser.selectTab).toHaveBeenNthCalledWith(2, 'website-8')
    expect(harness.browser.selectTab).toHaveBeenNthCalledWith(3, 'website-9')
    expect(harness.browser.selectTab).not.toHaveBeenCalledWith('home')

    harness.browser.selectTab.mockClear()
    harness.state.value = { ...browserState('home'), tabs: [{ ...home, active: true }] }
    await expect(harness.controller.run('select-tab-8')).resolves.toBe(true)
    await expect(harness.controller.run('select-last-tab')).resolves.toBe(true)
    expect(harness.browser.selectTab).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('keeps Home in relative navigation so Ctrl+Tab can leave and return to it', async () => {
    const harness = createController()
    harness.state.value = {
      ...browserState('home'),
      tabs: [{ ...tab('home', true), url: 'hronaut://home/' }, tab('first'), tab('second'), tab('third')]
    }

    await harness.controller.selectRelativeTab(1)

    expect(harness.browser.selectTab).toHaveBeenCalledWith('first')
    harness.controller.dispose()
  })

  it('queues rapid relative tab shortcuts so every press advances from the latest selection', async () => {
    const harness = createController()
    const firstSelection = deferred<BrowserState>()
    harness.browser.selectTab
      .mockReturnValueOnce(firstSelection.promise)
      .mockImplementation(async (tabId: string) => browserState(tabId))
    harness.syncState.mockImplementation(async (operation: Promise<BrowserState> | BrowserState) => {
      harness.state.value = await operation
    })

    const firstRun = harness.controller.run('next-tab')
    const secondRun = harness.controller.run('next-tab')

    await vi.waitFor(() => expect(harness.browser.selectTab).toHaveBeenCalledTimes(1))
    expect(harness.browser.selectTab).toHaveBeenLastCalledWith('third')

    firstSelection.resolve(browserState('third'))
    await vi.waitFor(() => expect(harness.browser.selectTab).toHaveBeenCalledTimes(2))
    expect(harness.browser.selectTab).toHaveBeenLastCalledWith('first')
    await expect(Promise.all([firstRun, secondRun])).resolves.toEqual([true, true])
    expect(harness.state.value.activeTabId).toBe('first')
    harness.controller.dispose()
  })

  it('continues queued tab navigation after an earlier selection fails', async () => {
    const harness = createController()
    const firstSelection = deferred<BrowserState>()
    const failure = new Error('selection failed')
    harness.browser.selectTab
      .mockReturnValueOnce(firstSelection.promise)
      .mockImplementation(async (tabId: string) => browserState(tabId))
    harness.syncState.mockImplementation(async (operation: Promise<BrowserState> | BrowserState) => {
      harness.state.value = await operation
    })

    const firstRun = harness.controller.run('next-tab')
    const secondRun = harness.controller.run('next-tab')
    await vi.waitFor(() => expect(harness.browser.selectTab).toHaveBeenCalledTimes(1))

    firstSelection.reject(failure)
    await expect(firstRun).resolves.toBe(false)
    await vi.waitFor(() => expect(harness.browser.selectTab).toHaveBeenCalledTimes(2))
    await expect(secondRun).resolves.toBe(true)

    expect(harness.browser.selectTab).toHaveBeenNthCalledWith(2, 'third')
    expect(harness.callbacks.onError).toHaveBeenCalledWith('next-tab', failure)
    expect(harness.state.value.activeTabId).toBe('third')
    harness.controller.dispose()
  })

  it('keeps close-tab available while website interaction is globally locked', async () => {
    const harness = createController()
    harness.state.value = { ...harness.state.value, allHumanInteractionLocked: true }

    await expect(harness.controller.run('close-tab')).resolves.toBe(true)

    expect(harness.browser.closeTab).toHaveBeenCalledWith('second')
    expect(harness.callbacks.onError).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('ignores a delayed failure after disposal', async () => {
    const harness = createController()
    const pending = deferred<BrowserState>()
    harness.browser.reload.mockReturnValueOnce(pending.promise)

    const running = harness.controller.run('reload')
    harness.controller.dispose()
    pending.reject(new Error('late failure'))

    await expect(running).resolves.toBe(false)
    expect(harness.callbacks.onError).not.toHaveBeenCalled()
  })
})
