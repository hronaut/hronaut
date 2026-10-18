import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import type {
  BrowserDomChangesReport,
  BrowserReproRecording,
  BrowserTabState
} from '../../src/shared/types.js'

type DiagnosticsBrowser = Parameters<typeof useDiagnosticsController>[0]['browser']

function tab(id: string): BrowserTabState {
  return {
    id,
    title: 'Example',
    url: `https://example.test/${id}`,
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
    devToolsOpen: false
  }
}

function reproRecording(tabId: string): BrowserReproRecording {
  return {
    tabId,
    title: 'Example',
    startedAt: '2026-08-21T12:00:00.000Z',
    active: true,
    stepCount: 0,
    steps: [],
    truncated: false,
    caveats: []
  }
}

function domReport(tabId: string): BrowserDomChangesReport {
  return {
    tabId,
    title: 'Example',
    url: `https://example.test/${tabId}`,
    active: false,
    changeCount: 0,
    entries: [],
    truncated: false,
    droppedChanges: 0,
    summary: { childList: 0, attributes: 0, text: 0, addedNodes: 0, removedNodes: 0 },
    caveats: []
  }
}

// The panel watchers live in the panel modules, but the controller registers
// them after its page-context watcher. A separately open panel must therefore
// reset for the new page first and then refresh, rather than refresh first and
// have the reset discard that refresh.
describe('diagnostics watcher order', () => {
  const controllers: ReturnType<typeof useDiagnosticsController>[] = []

  // Dispose even when an assertion fails, so no DOM changes refresh timer outlives its test.
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.dispose()
  })

  function createController() {
    const activeTab = ref<BrowserTabState | undefined>(tab('tab-1'))
    const browser = {
      manageRepro: vi.fn(async (_action: string, tabId: string) => reproRecording(tabId)),
      manageDomChanges: vi.fn(async (_action: string, tabId: string) => domReport(tabId))
    } as unknown as DiagnosticsBrowser
    const controller = useDiagnosticsController({
      activeTab,
      browser,
      translate: (key) => key,
      copyText: vi.fn(async () => true),
      closeTransientPanels: vi.fn(),
      keepsSeparatePanelOpen: () => true
    })
    controllers.push(controller)
    return { activeTab, controller }
  }

  it('refreshes a separately open Repro panel for the new tab after the context reset', async () => {
    const { activeTab, controller } = createController()
    controller.toggleReproRecorder()
    await flushPromises()
    expect(controller.reproRecording.value?.tabId).toBe('tab-1')

    activeTab.value = tab('tab-2')
    await flushPromises()

    expect(controller.reproPanelOpen.value).toBe(true)
    expect(controller.reproState.value).toBe('ready')
    expect(controller.reproRecording.value?.tabId).toBe('tab-2')
  })

  it('refreshes a separately open DOM changes panel for the new tab after the context reset', async () => {
    const { activeTab, controller } = createController()
    controller.toggleDomChanges()
    await flushPromises()
    expect(controller.domChangesReport.value?.tabId).toBe('tab-1')

    activeTab.value = tab('tab-2')
    await flushPromises()

    expect(controller.domChangesPanelOpen.value).toBe(true)
    expect(controller.domChangesState.value).toBe('ready')
    expect(controller.domChangesReport.value?.tabId).toBe('tab-2')
  })
})
