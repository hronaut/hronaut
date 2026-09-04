import { nextTick, ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTabSearchController } from '../../src/renderer/src/composables/useTabSearchController.js'
import type {
  BrowserSavedTabGroupState,
  BrowserState,
  BrowserTabOverviewPreview,
  BrowserTabState
} from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function tab(id: string, active = false): BrowserTabState {
  return {
    id,
    navigationGeneration: 1,
    title: `Tab ${id}`,
    url: `https://${id}.example`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    active,
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

function savedGroup(id: string): BrowserSavedTabGroupState {
  return {
    id,
    name: `Saved ${id}`,
    color: 'purple',
    savedAt: '2026-08-22T00:00:00.000Z',
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    tabs: [{ title: 'Saved page', url: 'https://saved.example', pinned: false }]
  }
}

function browserState(tabs: BrowserTabState[] = [tab('alpha'), tab('beta', true)]): BrowserState {
  return {
    tabs,
    closedTabs: [],
    activeTabId: tabs.find((candidate) => candidate.active)?.id ?? null,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function createController(initialState = browserState()) {
  const state: Ref<BrowserState> = ref(initialState)
  const open = ref(false)
  const selectTab = vi.fn(async () => undefined)
  const expandTabGroup = vi.fn()
  const browser = {
    closeTab: vi.fn(async () => state.value),
    reopenClosedTab: vi.fn(async () => state.value),
    setTabPinned: vi.fn(async () => state.value),
    restoreSavedTabGroup: vi.fn(async () => state.value),
    deleteSavedTabGroup: vi.fn(async () => state.value),
    getTabOverviewPreviews: vi.fn(async (_tabIds: string[]): Promise<BrowserTabOverviewPreview[]> => [])
  }
  const syncState = vi.fn(async (next: Promise<BrowserState> | BrowserState) => {
    state.value = await Promise.resolve(next)
  })
  const showError = vi.fn()
  const controller = useTabSearchController({
    state,
    open,
    mcpActivityByTab: ref({}),
    browser,
    syncState,
    selectTab,
    expandTabGroup,
    translate: (key) => key,
    formatNumber: String,
    formatTime: String,
    describeEmulation: () => '',
    confirm: () => true,
    formatError: (_cause, fallback) => fallback,
    showError
  })
  return { state, open, selectTab, expandTabGroup, browser, syncState, showError, controller }
}

describe('tab search controller', () => {
  it('does not activate a result with Enter while an overview action is pending', async () => {
    const { controller, browser, selectTab, state } = createController()
    const pending = deferred<BrowserState>()
    browser.setTabPinned.mockReturnValueOnce(pending.promise)
    try {
      await controller.openPanel()
      const pin = controller.togglePinnedTab(new MouseEvent('click'), state.value.tabs[0])
      expect(controller.actionPending.value).toBe(true)
      controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
      expect(selectTab).not.toHaveBeenCalled()
      pending.resolve(state.value)
      await pin
      controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
      expect(selectTab).toHaveBeenCalledWith('beta')
    } finally {
      pending.resolve(state.value)
      controller.dispose()
    }
  })

  it('contains a rejected tab selection and reports it through the shell', async () => {
    const { open, selectTab, showError, controller } = createController()
    await controller.openPanel()
    selectTab.mockRejectedValueOnce(new Error('tab disappeared'))

    await expect(controller.selectOpenTab(tab('alpha'))).resolves.toBeUndefined()

    expect(open.value).toBe(false)
    expect(showError).toHaveBeenCalledWith('runtime.workspace.openFailed', 'runtime.workspace.openDescription')
    controller.dispose()
  })

  it('serializes pin actions and contains a rejected mutation', async () => {
    const { browser, showError, controller } = createController()
    await controller.openPanel()
    const pending = deferred<BrowserState>()
    browser.setTabPinned.mockReturnValueOnce(pending.promise)
    const event = new MouseEvent('click')

    const firstPin = controller.togglePinnedTab(event, tab('alpha'))
    const repeatedPin = controller.togglePinnedTab(event, tab('beta'))

    expect(controller.actionPending.value).toBe(true)
    expect(browser.setTabPinned).toHaveBeenCalledOnce()
    pending.reject(new Error('tab disappeared'))
    await Promise.all([firstPin, repeatedPin])
    expect(showError).toHaveBeenCalledWith('runtimeDetails.browserAction', 'runtime.toast.actionFailed')
    expect(controller.actionPending.value).toBe(false)
    controller.dispose()
  })

  it('suppresses an older mutation failure after an external close and reopen', async () => {
    const { browser, open, showError, controller } = createController()
    await controller.openPanel()
    const pending = deferred<BrowserState>()
    browser.setTabPinned.mockReturnValueOnce(pending.promise)

    const pinning = controller.togglePinnedTab(new MouseEvent('click'), tab('alpha'))
    open.value = false
    await controller.openPanel()
    const repeatedPin = controller.togglePinnedTab(new MouseEvent('click'), tab('beta'))

    expect(controller.actionPending.value).toBe(true)
    expect(browser.setTabPinned).toHaveBeenCalledOnce()
    pending.reject(new Error('older failure'))
    await Promise.all([pinning, repeatedPin])

    expect(open.value).toBe(true)
    expect(showError).not.toHaveBeenCalled()
    expect(controller.actionPending.value).toBe(false)
    controller.dispose()
  })

  it('preserves the selected item identity when live results are inserted or reordered', async () => {
    const { state, controller } = createController()
    await controller.openPanel()
    expect(controller.selectedResult.value).toMatchObject({ kind: 'open', tab: { id: 'beta' } })

    state.value = { ...state.value, savedTabGroups: [savedGroup('research')] }
    expect(controller.selection.value).toBe(1)
    expect(controller.selectedResult.value).toMatchObject({ kind: 'open', tab: { id: 'beta' } })

    state.value = { ...state.value, tabs: [tab('beta', true), tab('alpha')] }
    expect(controller.selection.value).toBe(0)
    expect(controller.selectedResult.value).toMatchObject({ kind: 'open', tab: { id: 'beta' } })
    controller.dispose()
  })

  it('runs the still-selected tab after an archived workspace appears ahead of it', async () => {
    const { state, open, selectTab, expandTabGroup, controller } = createController()
    await controller.openPanel()
    state.value = { ...state.value, savedTabGroups: [savedGroup('research')] }

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(selectTab).toHaveBeenCalledWith('beta'))

    expect(expandTabGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }))
    expect(open.value).toBe(false)
    controller.dispose()
  })

  it('does not switch or move tabs while an IME composition owns the key', async () => {
    const { open, selectTab, controller } = createController()
    await controller.openPanel()
    const initialSelection = controller.selection.value

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    await Promise.resolve()

    expect(controller.selection.value).toBe(initialSelection)
    expect(selectTab).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
    controller.dispose()
  })

  it('resets selection to the first match when the search query changes', async () => {
    const { controller } = createController()
    await controller.openPanel()
    controller.query.value = 'alpha'
    await nextTick()

    expect(controller.selection.value).toBe(0)
    expect(controller.selectedResult.value).toMatchObject({ kind: 'open', tab: { id: 'alpha' } })
    controller.dispose()
  })

  it('groups matching open tabs by workspace order and keeps ungrouped tabs available', () => {
    const research = { ...tab('research'), mcpGroupId: 'workspace-2', mcpGroupName: 'Research' }
    const defaultTab = { ...tab('default'), mcpGroupId: 'workspace-1', mcpGroupName: 'Default' }
    const loose = tab('loose')
    const initial = browserState([research, loose, defaultTab])
    initial.mcpTabGroups = [
      {
        id: 'workspace-1', name: 'Default', color: 'gray', createdAt: '', lastUsedAt: '', tabCount: 1,
        activeTabId: defaultTab.id, isDefault: true, storageKind: 'default', storageOriginCount: 0,
        navigationPolicy: { mode: 'unrestricted', rules: [] }
      },
      {
        id: 'workspace-2', name: 'Research', color: 'purple', createdAt: '', lastUsedAt: '', tabCount: 1,
        activeTabId: research.id, isDefault: false, storageKind: 'isolated', storageOriginCount: 0,
        navigationPolicy: { mode: 'unrestricted', rules: [] }
      }
    ]
    const { controller } = createController(initial)

    expect(controller.filteredWorkspaceGroups.value.map((group) => ({
      id: group.id,
      tabs: group.tabs.map((candidate) => candidate.id)
    }))).toEqual([
      { id: 'workspace-1', tabs: ['default'] },
      { id: 'workspace-2', tabs: ['research'] },
      { id: 'ungrouped', tabs: ['loose'] }
    ])
    expect(controller.results.value.filter((result) => result.kind === 'open').map((result) => result.tab.id)).toEqual([
      'default', 'research', 'loose'
    ])

    controller.query.value = 'Research'
    expect(controller.filteredWorkspaceGroups.value.map((group) => group.id)).toEqual(['workspace-2'])
    controller.dispose()
  })

  it('loads only awake tab previews and rejects a response from an older navigation', async () => {
    const awake = { ...tab('awake', true), navigationGeneration: 3 }
    const sleeping = { ...tab('sleeping'), sleeping: true, navigationGeneration: 2 }
    const { state, browser, controller } = createController(browserState([awake, sleeping]))
    const pending = deferred<Array<{
      tabId: string
      navigationGeneration: number
      dataUrl: string
      width: number
      height: number
    }>>()
    browser.getTabOverviewPreviews.mockReturnValueOnce(pending.promise)

    await controller.openPanel()
    expect(browser.getTabOverviewPreviews).toHaveBeenCalledWith(['awake'])
    state.value = {
      ...state.value,
      tabs: [{ ...awake, navigationGeneration: 4 }, sleeping]
    }
    pending.resolve([{
      tabId: 'awake',
      navigationGeneration: 3,
      dataUrl: 'data:image/jpeg;base64,b2xk',
      width: 360,
      height: 225
    }])
    await vi.waitFor(() => expect(controller.previewLoading.value).toBe(false))

    expect(controller.previewForTab(state.value.tabs[0])).toBeUndefined()
    expect(controller.previewForTab(sleeping)).toBeUndefined()
    controller.dispose()
  })

  it('clears sensitive preview data when the overview closes', async () => {
    const { open, browser, controller } = createController()
    browser.getTabOverviewPreviews.mockResolvedValueOnce([{
      tabId: 'alpha',
      navigationGeneration: 1,
      dataUrl: 'data:image/jpeg;base64,cHJldmlldw==',
      width: 360,
      height: 225
    }])

    await controller.openPanel()
    await vi.waitFor(() => expect(controller.previewForTab(tab('alpha'))).toBeDefined())
    open.value = false

    expect(controller.previewsByTab.value).toEqual({})
    controller.dispose()
  })

  it('refreshes previews while open and pauses when the window is not focused', async () => {
    vi.useFakeTimers()
    try {
      const { browser, controller } = createController()
      browser.getTabOverviewPreviews.mockResolvedValue([])

      await controller.openPanel()
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(1))
      expect(controller.previewRefreshPaused.value).toBe(false)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(2)

      window.dispatchEvent(new Event('blur'))
      expect(controller.previewRefreshPaused.value).toBe(true)
      await vi.advanceTimersByTimeAsync(3_000)
      expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(2)

      window.dispatchEvent(new Event('focus'))
      expect(controller.previewRefreshPaused.value).toBe(false)
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(3))
      controller.close()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(3)
      controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the last valid preview while a later live refresh is unavailable', async () => {
    const { browser, controller } = createController()
    browser.getTabOverviewPreviews
      .mockResolvedValueOnce([{
        tabId: 'alpha',
        navigationGeneration: 1,
        dataUrl: 'data:image/jpeg;base64,cHJldmlldw==',
        width: 360,
        height: 225
      }])
      .mockResolvedValueOnce([])

    await controller.openPanel()
    await vi.waitFor(() => expect(controller.previewForTab(tab('alpha'))).toBeDefined())
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(2))

    expect(controller.previewForTab(tab('alpha'))).toBeDefined()
    controller.dispose()
  })

  it('bounds recurring preview requests after the initial overview hydration', async () => {
    const tabs = Array.from({ length: 12 }, (_, index) => tab(`tab-${index}`, index === 11))
    const { browser, controller } = createController(browserState(tabs))

    await controller.openPanel()
    await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(1))
    expect(browser.getTabOverviewPreviews.mock.calls[0]?.[0]).toHaveLength(12)

    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(2))
    expect(browser.getTabOverviewPreviews.mock.calls[1]?.[0]).toHaveLength(4)
    expect(browser.getTabOverviewPreviews.mock.calls[1]?.[0]).toContain('tab-11')
    controller.dispose()
  })

  it('supports vertical navigation without stealing search-field caret or IME keys', async () => {
    const { controller } = createController()
    await controller.openPanel()

    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    controller.handleKeydown(right)
    controller.handleKeydown(left)
    expect(controller.selection.value).toBe(1)
    expect(right.defaultPrevented).toBe(false)
    expect(left.defaultPrevented).toBe(false)
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(controller.selection.value).toBe(0)
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(controller.selection.value).toBe(1)
    const home = new KeyboardEvent('keydown', { key: 'Home', cancelable: true })
    const end = new KeyboardEvent('keydown', { key: 'End', cancelable: true })
    controller.handleKeydown(home)
    controller.handleKeydown(end)
    expect(controller.selection.value).toBe(1)
    expect(home.defaultPrevented).toBe(false)
    expect(end.defaultPrevented).toBe(false)
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    expect(controller.selection.value).toBe(1)
    controller.dispose()
  })

  it('does not reopen after it is closed while initial focus is still pending', async () => {
    const { open, controller } = createController()
    const opening = controller.openPanel()
    controller.close()
    await opening

    expect(open.value).toBe(false)
    controller.dispose()
  })
})
