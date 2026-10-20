import { render } from '@testing-library/vue'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DiagnosticsPanels from '../../src/renderer/src/features/diagnostics/DiagnosticsPanels.vue'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState, PanelDock } from '../../src/shared/types.js'

type DiagnosticsBrowser = Parameters<typeof useDiagnosticsController>[0]['browser']
type Controller = ReturnType<typeof useDiagnosticsController>

const firstPage = { id: 'tab-1', title: 'First', url: 'https://example.test/first', loading: false, navigationGeneration: 1 } as BrowserTabState
const secondPage = { ...firstPage, url: 'https://example.test/second', navigationGeneration: 2 }

// The main window keeps a panel open while it shows in its own window; the panel window itself always does.
function renderPanels(panelWindow = false) {
  let dock: PanelDock = 'window'
  const keepsSeparatePanelOpen = () => panelWindow || dock === 'window'
  // Requests never answer, so each panel only shows that it is running.
  const pending = () => new Promise<never>(() => undefined)
  const browser = {
    measurePerformance: vi.fn(pending), inspectDesign: vi.fn(pending), inspectPageMetadata: vi.fn(pending), inspectSecurity: vi.fn(pending),
    manageCodeCoverage: vi.fn(pending), manageCpuProfile: vi.fn(pending), measureMemory: vi.fn(pending), createDebugReport: vi.fn(pending),
    manageRepro: vi.fn(pending), manageDomChanges: vi.fn(pending), visualCompare: vi.fn(pending), copyVisualDiff: vi.fn(),
    listInspectorIssues: vi.fn(pending), runAccessibilityAudit: vi.fn(pending), runQualityAudit: vi.fn(pending)
  } satisfies DiagnosticsBrowser
  const activeTab = ref<BrowserTabState | undefined>(firstPage)
  const controller = useDiagnosticsController({
    activeTab,
    browser,
    translate: key => key,
    copyText: async () => true,
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen
  })
  const view = render(DiagnosticsPanels, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      dock: 'window', activeTab: firstPage, locale: 'en-US', controller,
      openSupport: vi.fn(async () => undefined), preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen
    }
  })
  const moveTo = async (next: PanelDock, tab?: BrowserTabState) => {
    dock = next
    await view.rerender({ dock: next, ...(tab ? { activeTab: tab } : {}) })
  }
  return { view, controller, browser, activeTab, moveTo }
}

beforeEach(() => {
  // The debug report's incident review discards its draft when the report is reset.
  vi.stubGlobal('hronaut', { discardIncident: vi.fn(async () => undefined), invalidateIncidentPreview: vi.fn(async () => undefined) })
})
afterEach(() => { vi.unstubAllGlobals() })

type Browser = ReturnType<typeof renderPanels>['browser']

// The main window kept these panels open, hidden, while they showed in their own window. A page change meanwhile cleared
// their report there, so docked back they showed only their header, with nothing to run.
const panels: Array<{ name: string, open: (controller: Controller) => { value: boolean }, state: (controller: Controller) => { value: string }, request: (browser: Browser) => ReturnType<typeof vi.fn> }> = [
  { name: 'Quality audit', open: controller => controller.qualityAuditPanelOpen, state: controller => controller.qualityAuditState, request: browser => browser.runQualityAudit },
  { name: 'Accessibility', open: controller => controller.accessibilityPanelOpen, state: controller => controller.accessibilityAuditState, request: browser => browser.runAccessibilityAudit },
  { name: 'Performance', open: controller => controller.performancePanelOpen, state: controller => controller.performanceState, request: browser => browser.measurePerformance },
  { name: 'Design overview', open: controller => controller.designOverviewPanelOpen, state: controller => controller.designOverviewState, request: browser => browser.inspectDesign },
  { name: 'Page metadata', open: controller => controller.metadata.pageMetadataPanelOpen, state: controller => controller.metadata.pageMetadataState, request: browser => browser.inspectPageMetadata },
  { name: 'Security', open: controller => controller.securityPanelOpen, state: controller => controller.securityReportState, request: browser => browser.inspectSecurity },
  { name: 'Memory', open: controller => controller.memoryPanelOpen, state: controller => controller.memoryState, request: browser => browser.measureMemory },
  { name: 'Debug report', open: controller => controller.debugReportPanelOpen, state: controller => controller.debugReportState, request: browser => browser.createDebugReport }
]

describe.each(panels)('$name docked back from its window', ({ open, state, request }) => {
  it('runs again for the page shown now when a page change cleared it', async () => {
    const { view, controller, browser, activeTab, moveTo } = renderPanels()
    try {
      open(controller).value = true
      activeTab.value = secondPage
      await moveTo('window', secondPage)
      expect(open(controller).value).toBe(true)
      expect(state(controller).value).toBe('idle')
      expect(request(browser)).not.toHaveBeenCalled()
      await moveTo('right')
      expect(request(browser)).toHaveBeenCalledOnce()
      expect(open(controller).value).toBe(true)
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('keeps what it shows when nothing cleared it', async () => {
    const { view, controller, browser, moveTo } = renderPanels()
    try {
      open(controller).value = true
      state(controller).value = 'error'
      await moveTo('right')
      expect(request(browser)).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('does not run in the panel window as it docks back and closes', async () => {
    const { view, controller, browser, activeTab, moveTo } = renderPanels(true)
    try {
      open(controller).value = true
      activeTab.value = secondPage
      await moveTo('right', secondPage)
      expect(request(browser)).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      controller.dispose()
    }
  })
})
