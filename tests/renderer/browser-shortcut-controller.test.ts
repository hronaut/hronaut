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
    reloadIgnoringCache: vi.fn(async (_tabId?: string) => state.value)
  }
  const syncState = vi.fn(async (operation: Promise<BrowserState> | BrowserState) => { await operation })
  const settingsOpen = ref(true)
  const callbacks = {
    openNewTab: vi.fn(async () => undefined),
    focusAddress: vi.fn(async () => undefined),
    openFind: vi.fn(async () => undefined),
    setZoom: vi.fn(async () => undefined),
    toggleCurrentBookmark: vi.fn(async () => undefined),
    toggleVisitHistory: vi.fn(async () => undefined),
    toggleTabSearch: vi.fn(async () => undefined),
    openPrivacySettings: vi.fn(async () => undefined),
    toggleCommandPalette: vi.fn(async () => undefined),
    toggleElementPicker: vi.fn(async () => undefined),
    toggleDeveloperTools: vi.fn(async () => undefined),
    onError: vi.fn()
  }
  const controller = useBrowserShortcutController({
    state,
    activeTab,
    browser,
    syncState,
    settingsOpen,
    canRunAction,
    ...callbacks
  })
  return { state, activeTab, browser, syncState, settingsOpen, callbacks, controller }
}

describe('browser shortcut controller', () => {
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

  it('blocks close-tab while human interaction is globally locked', async () => {
    const harness = createController()
    harness.state.value = { ...harness.state.value, allHumanInteractionLocked: true }

    await expect(harness.controller.run('close-tab')).resolves.toBe(false)

    expect(harness.browser.closeTab).not.toHaveBeenCalled()
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
