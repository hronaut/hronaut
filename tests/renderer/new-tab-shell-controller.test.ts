import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useNewTabShellController } from '../../src/renderer/src/composables/useNewTabShellController.js'
import type { BrowserState, BrowserTabGroupState, BrowserTabState, NewTabOptions } from '../../src/shared/types.js'

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

function workspace(id = 'workspace'): BrowserTabGroupState {
  return {
    id,
    name: 'QA workspace',
    color: 'blue',
    createdAt: '2026-08-25T00:00:00.000Z',
    lastUsedAt: '2026-08-25T00:00:00.000Z',
    isDefault: false,
    tabCount: 0,
    activeTabId: null,
    storageKind: 'isolated',
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] }
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
    mcpTabGroups: [workspace()],
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
  const browser = { newTab: vi.fn(async (_options?: NewTabOptions) => state.value) }
  const syncState = vi.fn(async (operation: Promise<BrowserState> | BrowserState) => { await operation })
  const settingsOpen = ref(true)
  const tabSearchOpen = ref(true)
  const focusAddress = vi.fn(async (_expectedActiveTabId: string): Promise<void> => undefined)
  const expandTabGroup = vi.fn()
  const onWorkspaceError = vi.fn()
  const controller = useNewTabShellController({
    state,
    browser,
    syncState,
    settingsOpen,
    tabSearchOpen,
    focusAddress,
    expandTabGroup,
    onWorkspaceError
  })
  return {
    state,
    browser,
    syncState,
    settingsOpen,
    tabSearchOpen,
    focusAddress,
    expandTabGroup,
    onWorkspaceError,
    controller
  }
}

describe('useNewTabShellController', () => {
  it('focuses and reveals a newly created workspace tab while closing conflicting overlays', async () => {
    const harness = createController()
    const created = {
      ...browserState('created'),
      tabs: [...browserState(null).tabs, tab('created', true)]
    }
    harness.browser.newTab.mockImplementationOnce(async () => {
      harness.state.value = created
      return created
    })

    await expect(harness.controller.openInWorkspace('workspace')).resolves.toBe(true)

    expect(harness.browser.newTab).toHaveBeenCalledWith({ active: true, mcpGroupId: 'workspace' })
    expect(harness.syncState).toHaveBeenCalledOnce()
    expect(harness.expandTabGroup).toHaveBeenCalledWith('workspace')
    expect(harness.focusAddress).toHaveBeenCalledWith('created')
    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.tabSearchOpen.value).toBe(false)
  })

  it('does not steal focus or reopen a group when a newer tab selection wins a delayed creation race', async () => {
    const harness = createController()
    const pending = deferred<BrowserState>()
    harness.browser.newTab.mockReturnValueOnce(pending.promise)

    const opening = harness.controller.openDefault()
    harness.state.value = browserState('newer')
    pending.resolve({
      ...browserState('created'),
      tabs: [...browserState(null).tabs, tab('created', true)]
    })

    await expect(opening).resolves.toBe(false)
    expect(harness.focusAddress).not.toHaveBeenCalled()
    expect(harness.expandTabGroup).not.toHaveBeenCalled()
  })

  it('opens workspace tabs while page input is globally blocked and still rejects missing workspaces', async () => {
    const harness = createController()
    harness.state.value = { ...harness.state.value, allHumanInteractionLocked: true }
    const created = {
      ...browserState('created'),
      allHumanInteractionLocked: true,
      tabs: [...browserState(null).tabs, tab('created', true)]
    }
    harness.browser.newTab.mockImplementationOnce(async () => {
      harness.state.value = created
      return created
    })

    await expect(harness.controller.openInWorkspace('workspace')).resolves.toBe(true)
    expect(harness.browser.newTab).toHaveBeenCalledWith({ active: true, mcpGroupId: 'workspace' })

    await expect(harness.controller.openInWorkspace('missing')).resolves.toBe(false)

    expect(harness.browser.newTab).toHaveBeenCalledOnce()
  })

  it('contains and reports workspace creation failures', async () => {
    const harness = createController()
    const failure = new Error('workspace profile unavailable')
    harness.browser.newTab.mockRejectedValueOnce(failure)

    await expect(harness.controller.openInWorkspace('workspace')).resolves.toBe(false)

    expect(harness.onWorkspaceError).toHaveBeenCalledWith(workspace(), failure)
  })
})
