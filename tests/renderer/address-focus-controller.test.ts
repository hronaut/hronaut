import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAddressFocusController } from '../../src/renderer/src/composables/useAddressFocusController.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string, active = false, url = `https://${id}.test/`): BrowserTabState {
  return {
    id,
    url,
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

function browserState(activeTabId: string | null = 'current'): BrowserState {
  return {
    tabs: [tab('current', activeTabId === 'current'), tab('newer', activeTabId === 'newer')],
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

function createController() {
  const state = ref(browserState())
  const home = ref(false)
  const preferred = ref<BrowserTabState | undefined>()
  const browser = { newTab: vi.fn(async () => state.value) }
  const syncState = vi.fn(async (operation: Promise<BrowserState> | BrowserState) => { await operation })
  const settingsOpen = ref(true)
  const updateNoticeOpen = ref(true)
  const zoomOpen = ref(true)
  const tabSearchOpen = ref(true)
  const selectBrowserTab = vi.fn(async (tabId: string) => {
    state.value = { ...state.value, activeTabId: tabId }
    return true
  })
  const runFindTransition = vi.fn(async (action: () => void | Promise<void>) => { await action() })
  const focusInput = vi.fn()
  const controller = useAddressFocusController({
    state,
    isHome: () => home.value,
    preferredWebTab: () => preferred.value,
    selectBrowserTab,
    browser,
    syncState,
    settingsOpen,
    updateNoticeOpen,
    zoomOpen,
    tabSearchOpen,
    runFindTransition,
    focusInput
  })
  return {
    state,
    home,
    preferred,
    browser,
    syncState,
    settingsOpen,
    updateNoticeOpen,
    zoomOpen,
    tabSearchOpen,
    selectBrowserTab,
    runFindTransition,
    focusInput,
    controller
  }
}

describe('useAddressFocusController', () => {
  it('focuses the current tab address and closes conflicting overlays', async () => {
    const harness = createController()

    await expect(harness.controller.focus()).resolves.toBe(true)

    expect(harness.focusInput).toHaveBeenCalledOnce()
    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.updateNoticeOpen.value).toBe(false)
    expect(harness.zoomOpen.value).toBe(false)
    expect(harness.tabSearchOpen.value).toBe(false)
  })

  it('does not steal focus when the active tab changes before the DOM focus boundary', async () => {
    const harness = createController()
    const release = deferred<void>()
    harness.runFindTransition.mockImplementationOnce(async (action) => {
      await release.promise
      await action()
    })

    const focusing = harness.controller.focus('current')
    harness.state.value = browserState('newer')
    release.resolve()

    await expect(focusing).resolves.toBe(false)
    expect(harness.focusInput).not.toHaveBeenCalled()
  })

  it('returns from Home to the preferred website before focusing its address', async () => {
    const harness = createController()
    harness.home.value = true
    harness.preferred.value = tab('preferred')

    await expect(harness.controller.focus()).resolves.toBe(true)

    expect(harness.selectBrowserTab).toHaveBeenCalledWith('preferred')
    expect(harness.focusInput).toHaveBeenCalledOnce()
    expect(harness.browser.newTab).not.toHaveBeenCalled()
  })

  it('does not create or focus over a newer selection after delayed Home restoration', async () => {
    const harness = createController()
    const pending = deferred<boolean>()
    harness.home.value = true
    harness.preferred.value = tab('preferred')
    harness.selectBrowserTab.mockReturnValueOnce(pending.promise)

    const focusing = harness.controller.focus()
    harness.state.value = browserState('newer')
    pending.resolve(true)

    await expect(focusing).resolves.toBe(false)
    expect(harness.browser.newTab).not.toHaveBeenCalled()
    expect(harness.focusInput).not.toHaveBeenCalled()
  })

  it('does not create a fallback tab when failed Home restoration loses to a newer selection', async () => {
    const harness = createController()
    const pending = deferred<boolean>()
    harness.home.value = true
    harness.preferred.value = tab('preferred')
    harness.selectBrowserTab.mockReturnValueOnce(pending.promise)

    const focusing = harness.controller.focus()
    harness.state.value = browserState('newer')
    pending.resolve(false)

    await expect(focusing).resolves.toBe(false)
    expect(harness.browser.newTab).not.toHaveBeenCalled()
    expect(harness.focusInput).not.toHaveBeenCalled()
  })
})
