import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type {
  BrowserState,
  BrowserTabState,
  McpTabActivity
} from '../../src/shared/types.js'
import { useAppTabRuntimeFeatureController } from '../../src/renderer/src/composables/useAppTabRuntimeFeatureController.js'

function tab(id: string, preserveDiagnosticLogs = false): BrowserTabState {
  return {
    id,
    title: `Tab ${id}`,
    url: `https://${id}.example.test`,
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: false,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false
  }
}

function browserState(activeTabId: string | null = 'tab-1', tabs = [tab('tab-1'), tab('tab-2')]): BrowserState {
  return {
    tabs: tabs.map((entry) => ({ ...entry, active: entry.id === activeTabId })),
    closedTabs: [],
    activeTabId,
    allHumanInteractionLocked: false,
    mcpUrl: '',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function activity(tabId: string, activityId = 'activity-1'): McpTabActivity {
  return {
    tabId,
    activityId,
    toolName: 'browser_evaluate',
    phase: 'started',
    occurredAt: Date.now()
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

function createHarness() {
  const state = ref(browserState())
  const hydrated = ref(false)
  const unsubscribe = vi.fn()
  let activityListener: ((activity: McpTabActivity) => void) | undefined
  const browser = {
    setDiagnosticLogPreservation: vi.fn(async (tabId: string, preserve: boolean) => browserState(
      state.value.activeTabId,
      state.value.tabs.map((entry) => entry.id === tabId
        ? { ...entry, preserveDiagnosticLogs: preserve }
        : entry)
    )),
    onMcpTabActivity: vi.fn((listener: (activity: McpTabActivity) => void) => {
      activityListener = listener
      return unsubscribe
    })
  }
  const syncState = vi.fn(async (operation: Promise<BrowserState>) => {
    const next = await operation
    state.value = next
    return next
  })
  const onDiagnosticError = vi.fn()
  const controller = useAppTabRuntimeFeatureController({
    state,
    hydrated,
    browser,
    syncState,
    onDiagnosticError,
    activityLingerMs: 10
  })
  return {
    state,
    hydrated,
    browser,
    syncState,
    onDiagnosticError,
    unsubscribe,
    emitActivity: (activity: McpTabActivity) => activityListener?.(activity),
    controller
  }
}

function changeEvent(checked: boolean): Event {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  return { currentTarget: input } as unknown as Event
}

describe('useAppTabRuntimeFeatureController', () => {
  it('keeps active-tab diagnostics and MCP activity on the same browser-state boundary', async () => {
    const harness = createHarness()
    expect(harness.controller.activeTab.value?.id).toBe('tab-1')

    harness.emitActivity(activity('tab-2'))
    harness.emitActivity(activity('removed-tab', 'activity-2'))
    expect(Object.keys(harness.controller.mcpActivityByTab.value)).toEqual(['tab-2', 'removed-tab'])

    harness.state.value = browserState('tab-2')
    harness.hydrated.value = true
    await nextTick()

    expect(harness.controller.activeTab.value?.id).toBe('tab-2')
    expect(harness.controller.mcpActivityByTab.value['tab-2']).toBeDefined()
    expect(harness.controller.mcpActivityByTab.value['removed-tab']).toBeUndefined()

    await expect(harness.controller.updateDiagnosticLogPreservation(changeEvent(true))).resolves.toBe(true)
    expect(harness.browser.setDiagnosticLogPreservation).toHaveBeenCalledWith('tab-2', true)
    expect(harness.syncState).toHaveBeenCalledOnce()
    expect(harness.controller.activeTab.value?.preserveDiagnosticLogs).toBe(true)
    expect(harness.controller.diagnosticLogPreservationBusy.value).toBe(false)
    harness.controller.dispose()
  })

  it('disposes diagnostics even when the native MCP listener cleanup fails', async () => {
    const harness = createHarness()
    const pending = deferred<BrowserState>()
    harness.browser.setDiagnosticLogPreservation.mockImplementationOnce(() => pending.promise)
    const update = harness.controller.updateDiagnosticLogPreservation(changeEvent(true))
    harness.emitActivity(activity('tab-1'))
    harness.unsubscribe.mockImplementationOnce(() => {
      throw new Error('listener already closed')
    })

    expect(() => harness.controller.dispose()).toThrow('listener already closed')
    pending.reject(new Error('late diagnostic failure'))

    await expect(update).resolves.toBe(false)
    expect(harness.onDiagnosticError).not.toHaveBeenCalled()
    expect(harness.controller.diagnosticLogPreservationBusy.value).toBe(false)
    expect(harness.controller.mcpActivityByTab.value).toEqual({})
    harness.emitActivity(activity('tab-1', 'late-activity'))
    expect(harness.controller.mcpActivityByTab.value).toEqual({})
    expect(() => harness.controller.dispose()).not.toThrow()
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
  })

  it('rolls back the native MCP listener when tab-state tracking cannot initialize', () => {
    const setupFailure = new Error('tab state unavailable')
    const state = ref(browserState())
    Object.defineProperty(state, 'value', {
      configurable: true,
      get: () => { throw setupFailure }
    })
    const unsubscribe = vi.fn()
    const onMcpTabActivity = vi.fn(() => unsubscribe)

    expect(() => useAppTabRuntimeFeatureController({
      state,
      hydrated: ref(true),
      browser: {
        setDiagnosticLogPreservation: vi.fn(),
        onMcpTabActivity
      },
      syncState: vi.fn(),
      onDiagnosticError: vi.fn()
    })).toThrow(setupFailure)

    expect(onMcpTabActivity).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
