import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTabNavigationController } from '../../src/renderer/src/composables/useTabNavigationController.js'
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

function browserState(activeTabId: string, ids = ['current']): BrowserState {
  return {
    tabs: ids.map((id) => tab(id, id === activeTabId)),
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
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function createController() {
  const state = ref(browserState('current'))
  const created = deferred<BrowserState>()
  const settingsOpen = ref(false)
  const updateNoticeOpen = ref(false)
  const zoomOpen = ref(true)
  const tabSearchOpen = ref(true)
  const downloadsOpen = ref(false)
  const commandPaletteOpen = ref(false)
  const focusInput = vi.fn()
  const controller = useTabNavigationController({
    state,
    isHome: () => false,
    preferredWebTab: () => undefined,
    selectBrowserTab: vi.fn(async () => true),
    browser: { newTab: vi.fn(() => created.promise) },
    syncState: vi.fn(async (operation: Promise<BrowserState> | BrowserState) => { state.value = await operation }),
    settingsOpen,
    updateNoticeOpen,
    zoomOpen,
    tabSearchOpen,
    otherSurfacesOpen: [downloadsOpen, commandPaletteOpen],
    runFindTransition: async (action) => { await action() },
    focusInput,
    expandTabGroup: vi.fn(),
    onWorkspaceError: vi.fn()
  })
  return { created, settingsOpen, zoomOpen, tabSearchOpen, downloadsOpen, commandPaletteOpen, focusInput, controller }
}

describe('useTabNavigationController', () => {
  it('focuses a new tab\'s address and closes the overlays that were open when it was asked for', async () => {
    const harness = createController()

    const opening = harness.controller.openNewTab()
    harness.created.resolve(browserState('created', ['current', 'created']))

    await expect(opening).resolves.toBe(true)
    expect(harness.tabSearchOpen.value).toBe(false)
    expect(harness.zoomOpen.value).toBe(false)
    expect(harness.focusInput).toHaveBeenCalledOnce()
  })

  it('leaves Settings, opened while the new tab was being created, open and focused', async () => {
    const harness = createController()

    // Ctrl+T, then Settings before main answers.
    const opening = harness.controller.openNewTab()
    harness.settingsOpen.value = true
    harness.created.resolve(browserState('created', ['current', 'created']))

    await expect(opening).resolves.toBe(true)
    expect(harness.settingsOpen.value).toBe(true)
    expect(harness.focusInput).not.toHaveBeenCalled()
  })

  it('leaves Downloads or Commands, opened while the new tab was being created, open and focused', async () => {
    for (const opened of ['downloadsOpen', 'commandPaletteOpen'] as const) {
      const harness = createController()

      const opening = harness.controller.openNewTab()
      harness[opened].value = true
      harness.created.resolve(browserState('created', ['current', 'created']))

      await expect(opening, opened).resolves.toBe(true)
      expect(harness[opened].value, opened).toBe(true)
      expect(harness.zoomOpen.value, opened).toBe(true)
      expect(harness.focusInput, opened).not.toHaveBeenCalled()
    }
  })
})
