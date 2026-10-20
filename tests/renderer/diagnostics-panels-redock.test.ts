import { render } from '@testing-library/vue'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import DiagnosticsPanels from '../../src/renderer/src/features/diagnostics/DiagnosticsPanels.vue'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState } from '../../src/shared/types.js'

type DiagnosticsBrowser = Parameters<typeof useDiagnosticsController>[0]['browser']
type Controller = ReturnType<typeof useDiagnosticsController>

const tab = { id: 'tab-1', title: 'Example', url: 'https://example.test/app', loading: false } as BrowserTabState

function renderPanels(keepsSeparatePanelOpen = () => false) {
  // Requests never answer, so each panel only shows that it is loading.
  const pending = () => new Promise<never>(() => undefined)
  const browser = {
    measurePerformance: vi.fn(), inspectDesign: vi.fn(), inspectPageMetadata: vi.fn(), inspectSecurity: vi.fn(),
    manageCodeCoverage: vi.fn(pending), manageCpuProfile: vi.fn(pending), measureMemory: vi.fn(), createDebugReport: vi.fn(),
    manageRepro: vi.fn(), manageDomChanges: vi.fn(), visualCompare: vi.fn(pending), copyVisualDiff: vi.fn(),
    listInspectorIssues: vi.fn(pending), runAccessibilityAudit: vi.fn(), runQualityAudit: vi.fn()
  } satisfies DiagnosticsBrowser
  const controller = useDiagnosticsController({
    activeTab: ref<BrowserTabState | undefined>(tab),
    browser,
    translate: key => key,
    copyText: async () => true,
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen
  })
  const view = render(DiagnosticsPanels, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      dock: 'window', activeTab: tab, locale: 'en-US', controller,
      openSupport: vi.fn(async () => undefined), preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen
    }
  })
  return { view, controller, browser }
}

type Browser = ReturnType<typeof renderPanels>['browser']

// The main window kept these panels open, hidden, while they showed in their own window, so docked back they showed the
// comparison, issues, coverage or profile they had before they left.
const panels = [
  { name: 'Visual compare', open: (controller: Controller) => controller.visualComparePanelOpen, state: (controller: Controller) => controller.visualCompareState, request: (browser: Browser) => browser.visualCompare, called: [expect.objectContaining({ tabId: 'tab-1', action: 'get' })] as unknown[] },
  { name: 'Issues', open: (controller: Controller) => controller.inspectorIssuesOpen, state: (controller: Controller) => controller.inspectorIssuesState, request: (browser: Browser) => browser.listInspectorIssues, called: ['tab-1', false] as unknown[] },
  { name: 'Code coverage', open: (controller: Controller) => controller.coveragePanelOpen, state: (controller: Controller) => controller.coverageState, request: (browser: Browser) => browser.manageCodeCoverage, called: [expect.objectContaining({ tabId: 'tab-1', action: 'get' })] as unknown[] },
  { name: 'CPU profile', open: (controller: Controller) => controller.cpuProfilePanelOpen, state: (controller: Controller) => controller.cpuProfileState, request: (browser: Browser) => browser.manageCpuProfile, called: [expect.objectContaining({ tabId: 'tab-1', action: 'get' })] as unknown[] }
]

describe.each(panels)('$name docked back from its window', ({ open, state, request, called }) => {
  it('reads the tab again', async () => {
    const { view, controller, browser } = renderPanels()
    open(controller).value = true
    await view.rerender({ dock: 'window' })
    expect(request(browser)).not.toHaveBeenCalled()
    await view.rerender({ dock: 'right' })
    expect(request(browser)).toHaveBeenCalledExactlyOnceWith(...called)
    view.unmount()
    controller.dispose()
  })

  it('leaves a request still running to answer', async () => {
    const { view, controller, browser } = renderPanels()
    open(controller).value = true
    state(controller).value = 'loading'
    await view.rerender({ dock: 'right' })
    expect(request(browser)).not.toHaveBeenCalled()
    view.unmount()
    controller.dispose()
  })

  it('does not read the tab in the panel window as it docks back and closes', async () => {
    const { view, controller, browser } = renderPanels(() => true)
    open(controller).value = true
    await view.rerender({ dock: 'right' })
    expect(request(browser)).not.toHaveBeenCalled()
    view.unmount()
    controller.dispose()
  })
})
