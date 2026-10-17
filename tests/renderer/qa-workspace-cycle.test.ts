import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBrowserShortcutController } from '../../src/renderer/src/composables/useBrowserShortcutController.js'
import type { BrowserState, BrowserTabGroupState, BrowserTabState } from '../../src/shared/types.js'
import { WORKSPACE_CYCLE_MS } from '../../src/shared/workspace-shortcuts.js'

interface WorkspaceSpec {
  id: string
  lastUsedAt: string
  pinnedAt?: string
  /** Workspaces without tabs open on a new tab. */
  tabless?: boolean
}

function tab(id: string, mcpGroupId: string): BrowserTabState {
  return {
    id, url: `https://${id}.test/`, title: id, active: false, loading: false, navigationGeneration: 0,
    canGoBack: false, canGoForward: false, pinned: false, sleeping: false, humanInteractionLocked: false,
    preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false, mcpGroupId
  }
}

function group(spec: WorkspaceSpec): BrowserTabGroupState {
  return {
    id: spec.id, name: spec.id, description: '', color: 'blue', createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: spec.lastUsedAt, tabCount: spec.tabless ? 0 : 1, activeTabId: spec.tabless ? null : `${spec.id}-tab`,
    storageOriginCount: 0, navigationPolicy: { mode: 'unrestricted', rules: [] },
    ...(spec.pinnedAt ? { pinnedAt: spec.pinnedAt } : {})
  }
}

const controllers: { dispose: () => void }[] = []

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose())
  vi.restoreAllMocks()
})

function harness(specs: WorkspaceSpec[], startIn: string) {
  let clock = 10_000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  const tabs = specs.filter((spec) => !spec.tabless).map((spec) => tab(`${spec.id}-tab`, spec.id))
  const state = ref<BrowserState>({
    tabs, closedTabs: [], activeTabId: `${startIn}-tab`, allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp', profilePath: '/tmp/profile', mcpTabGroups: specs.map(group), savedTabGroups: []
  })
  const activeTab = ref<BrowserTabState | undefined>(tabs.find((candidate) => candidate.id === `${startIn}-tab`))
  // Main shows the tab and the shell's state follows it.
  const show = (tabId: string) => {
    state.value = { ...state.value, activeTabId: tabId }
    activeTab.value = state.value.tabs.find((candidate) => candidate.id === tabId)
    return state.value
  }
  const browser = {
    closeTab: vi.fn(async () => state.value),
    reopenClosedTab: vi.fn(async () => state.value),
    selectTab: vi.fn(async (tabId: string) => show(tabId)),
    reload: vi.fn(async () => state.value),
    reloadIgnoringCache: vi.fn(async () => state.value),
    newTab: vi.fn(async (options?: { mcpGroupId?: string; active?: boolean }) => {
      const created = tab(`${options?.mcpGroupId}-new`, options!.mcpGroupId!)
      state.value = { ...state.value, tabs: [...state.value.tabs, created] }
      return show(created.id)
    })
  }
  const noop = vi.fn(async () => undefined)
  const controller = useBrowserShortcutController({
    state, activeTab, browser,
    syncState: async (operation) => { await operation },
    settingsOpen: ref(false),
    canRunAction: () => true,
    openNewTab: noop, focusAddress: noop, openFind: noop, setZoom: noop, toggleCurrentBookmark: noop,
    toggleVisitHistory: noop, toggleTabSearch: noop, openPrivacySettings: noop, toggleCommandPalette: noop,
    toggleElementPicker: noop, toggleDeveloperTools: noop,
    onError: vi.fn()
  })
  controllers.push(controller)
  const current = () => activeTab.value?.mcpGroupId
  /** The person looks at a workspace another way, such as by clicking its tab. */
  const view = async (workspaceId: string) => {
    show(`${workspaceId}-tab`)
    await nextTick()
  }
  const press = async (action: Parameters<typeof controller.run>[0]) => {
    await controller.run(action)
    await nextTick()
    return current()
  }
  const wait = (ms: number) => { clock += ms }
  return { controller, browser, state, current, view, press, wait }
}

const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 10, minute)).toISOString()

describe('previous-workspace key', () => {
  it('goes back to the workspace the person viewed before, not one an agent used more recently', async () => {
    const page = harness([
      { id: 'a', lastUsedAt: at(1) },
      { id: 'b', lastUsedAt: at(2) },
      { id: 'c', lastUsedAt: at(3) },
      // An agent bumped this one's last use while the person worked elsewhere.
      { id: 'agent', lastUsedAt: at(59) }
    ], 'a')
    await page.view('b')
    await page.view('c')
    page.wait(5_000)
    expect(await page.press('previous-workspace')).toBe('b')
  })

  it('steps further back when pressed again soon, then wraps around to where it started', async () => {
    const page = harness([
      { id: 'a', lastUsedAt: at(1) },
      { id: 'b', lastUsedAt: at(2) },
      { id: 'c', lastUsedAt: at(3) },
      { id: 'agent', lastUsedAt: at(59) }
    ], 'a')
    await page.view('b')
    await page.view('c')
    page.wait(5_000)
    const visited: (string | undefined)[] = []
    for (let press = 0; press < 5; press += 1) {
      visited.push(await page.press('previous-workspace'))
      page.wait(WORKSPACE_CYCLE_MS - 100)
    }
    // Viewed order first, then the rest by last use, then back where it started and round again.
    expect(visited).toEqual(['b', 'a', 'agent', 'c', 'b'])
  })

  it('goes back and forth after a pause instead of further back', async () => {
    const page = harness([
      { id: 'a', lastUsedAt: at(1) },
      { id: 'b', lastUsedAt: at(2) },
      { id: 'c', lastUsedAt: at(3) }
    ], 'a')
    await page.view('b')
    await page.view('c')
    page.wait(5_000)
    expect(await page.press('previous-workspace')).toBe('b')
    page.wait(WORKSPACE_CYCLE_MS + 1)
    expect(await page.press('previous-workspace')).toBe('c')
    page.wait(WORKSPACE_CYCLE_MS + 1)
    expect(await page.press('previous-workspace')).toBe('b')
  })

  it('starts over after the person moves another way, such as with a pinned-workspace key', async () => {
    const page = harness([
      { id: 'a', lastUsedAt: at(1) },
      { id: 'b', lastUsedAt: at(2) },
      { id: 'c', lastUsedAt: at(3) },
      { id: 'pinned', lastUsedAt: at(0), pinnedAt: at(0) }
    ], 'a')
    await page.view('b')
    await page.view('c')
    page.wait(5_000)
    expect(await page.press('previous-workspace')).toBe('b')
    page.wait(200)
    expect(await page.press('select-workspace-1')).toBe('pinned')
    page.wait(200)
    // Still within the cycle time, but the person is now neither where the key went nor where it left: it starts over
    // from the latest viewed, instead of going on to the next one further back ('a').
    expect(await page.press('previous-workspace')).toBe('b')
  })

  it('passes over a workspace closed since the first press', async () => {
    const page = harness([
      { id: 'a', lastUsedAt: at(1) },
      { id: 'b', lastUsedAt: at(2) },
      { id: 'c', lastUsedAt: at(3) }
    ], 'a')
    await page.view('b')
    await page.view('c')
    page.wait(5_000)
    expect(await page.press('previous-workspace')).toBe('b')
    page.state.value = { ...page.state.value, mcpTabGroups: page.state.value.mcpTabGroups.filter((entry) => entry.id !== 'a') }
    page.wait(200)
    expect(await page.press('previous-workspace')).toBe('c')
  })

  it('does nothing with a single workspace', async () => {
    const page = harness([{ id: 'only', lastUsedAt: at(1) }], 'only')
    expect(await page.press('previous-workspace')).toBe('only')
    expect(page.browser.selectTab).not.toHaveBeenCalled()
  })
})

describe('pinned-workspace keys', () => {
  it('open the pinned workspace at that position on its last active tab, or on a new tab when it has none', async () => {
    const page = harness([
      { id: 'home', lastUsedAt: at(5) },
      { id: 'second-pin', lastUsedAt: at(1), pinnedAt: at(20) },
      { id: 'first-pin', lastUsedAt: at(2), pinnedAt: at(10), tabless: true }
    ], 'home')
    expect(await page.press('select-workspace-2')).toBe('second-pin')
    expect(page.browser.selectTab).toHaveBeenLastCalledWith('second-pin-tab')
    expect(await page.press('select-workspace-1')).toBe('first-pin')
    expect(page.browser.newTab).toHaveBeenCalledWith({ mcpGroupId: 'first-pin', active: true })
  })

  it('do nothing past the last pinned workspace', async () => {
    const page = harness([
      { id: 'home', lastUsedAt: at(5) },
      { id: 'pin', lastUsedAt: at(1), pinnedAt: at(10) }
    ], 'home')
    expect(await page.press('select-workspace-2')).toBe('home')
    expect(page.browser.selectTab).not.toHaveBeenCalled()
    expect(page.browser.newTab).not.toHaveBeenCalled()
  })
})
