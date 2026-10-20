import { render, screen, waitFor, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import DebugReportPanel from '../../src/renderer/src/features/diagnostics/debug-report/DebugReportPanel.vue'
import DiagnosticsPanels from '../../src/renderer/src/features/diagnostics/DiagnosticsPanels.vue'
import DomChangesPanel from '../../src/renderer/src/features/diagnostics/dom-changes/DomChangesPanel.vue'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserDebugReport, BrowserDomChangesReport, BrowserTabState } from '../../src/shared/types.js'
import { getByTooltip } from './helpers/tooltip.js'

type DiagnosticsBrowser = Parameters<typeof useDiagnosticsController>[0]['browser']

const global = { plugins: [createHronautI18n('en-US')] }

function activeTab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/app',
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
    devToolsOpen: false,
    ...overrides
  }
}

function createController(tab: BrowserTabState, overrides: Partial<DiagnosticsBrowser> = {}) {
  const browser: DiagnosticsBrowser = {
    measurePerformance: vi.fn(), inspectDesign: vi.fn(), inspectPageMetadata: vi.fn(), inspectSecurity: vi.fn(),
    manageCodeCoverage: vi.fn(), manageCpuProfile: vi.fn(), measureMemory: vi.fn(), createDebugReport: vi.fn(),
    manageRepro: vi.fn(), manageDomChanges: vi.fn(), visualCompare: vi.fn(), copyVisualDiff: vi.fn(),
    listInspectorIssues: vi.fn(), runAccessibilityAudit: vi.fn(), runQualityAudit: vi.fn(),
    ...overrides
  }
  return useDiagnosticsController({
    activeTab: ref<BrowserTabState | undefined>(tab),
    browser,
    translate: key => key,
    copyText: async () => true,
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen: () => false
  })
}

function domChangesReport(): BrowserDomChangesReport {
  return {
    tabId: 'tab-1',
    title: 'Example',
    url: 'https://example.test/app',
    startedAt: '2026-09-15T10:00:00.000Z',
    stoppedAt: '2026-09-15T10:00:05.000Z',
    active: false,
    changeCount: 6,
    truncated: false,
    droppedChanges: 0,
    summary: { childList: 1, attributes: 3, text: 1, addedNodes: 2, removedNodes: 1 },
    caveats: [],
    entries: [
      { index: 1, kind: 'attributes', occurredAt: '2026-09-15T10:00:01.000Z', elapsedMs: 120, target: 'main > button', occurrences: 3, attributeName: 'aria-expanded' },
      { index: 2, kind: 'text', occurredAt: '2026-09-15T10:00:02.000Z', elapsedMs: 240, target: 'main > p', occurrences: 1 },
      { index: 3, kind: 'child-list', occurredAt: '2026-09-15T10:00:03.000Z', elapsedMs: 360, target: 'main > ul', occurrences: 1, addedNodes: 2, removedNodes: 1, addedTags: ['li'] }
    ]
  }
}

function debugReport(): BrowserDebugReport {
  return {
    generatedAt: '2026-09-15T10:05:00.000Z',
    tabId: 'tab-1',
    title: 'Example',
    url: 'https://example.test/app',
    networkRouteCount: 0,
    summary: {
      consoleMessages: 1, consoleWarnings: 0, consoleErrors: 1, networkRequests: 4,
      failedRequests: 2, pendingRequests: 0, cachedRequests: 0, responseBytes: 2_048
    },
    console: [{ timestamp: '2026-09-15T10:04:00.000Z', level: 'error', message: 'fixture failure', lineNumber: 12, sourceId: 'https://example.test/app.js' }],
    network: [
      { id: 'missing', url: 'https://example.test/missing.js', method: 'GET', resourceType: 'script', startedAt: '2026-09-15T10:04:01.000Z', status: 404, detailsAvailable: false, issue: true },
      { id: 'blocked', url: 'https://example.test/blocked', method: 'POST', resourceType: 'fetch', startedAt: '2026-09-15T10:04:02.000Z', error: 'net::ERR_BLOCKED_BY_CLIENT', detailsAvailable: false, issue: true }
    ],
    truncated: { console: false, network: false },
    caveats: []
  }
}

describe('split diagnostic panels', () => {
  it('composes every docked diagnostic panel in its original order behind each open state', async () => {
    const controller = createController(activeTab(), {
      manageDomChanges: vi.fn(() => new Promise<BrowserDomChangesReport>(() => undefined))
    })
    const view = render(DiagnosticsPanels, {
      global,
      props: {
        dock: 'right', activeTab: undefined, locale: 'en-US', controller,
        openSupport: vi.fn(async () => undefined), preservationBusy: false, updatePreservation: vi.fn(),
        keepsSeparatePanelOpen: () => false
      }
    })
    const dockedPanels = (): Array<string | null> => [...view.container.querySelectorAll('[data-shell-docked-panel]')]
      .map(panel => panel.getAttribute('aria-labelledby'))
    expect(dockedPanels()).toEqual([])

    for (const open of [
      controller.qualityAuditPanelOpen, controller.accessibilityPanelOpen, controller.performancePanelOpen,
      controller.designOverviewPanelOpen, controller.metadata.pageMetadataPanelOpen, controller.securityPanelOpen,
      controller.coveragePanelOpen, controller.cpuProfilePanelOpen, controller.memoryPanelOpen,
      controller.inspectorIssuesOpen, controller.debugReportPanelOpen, controller.reproPanelOpen,
      controller.domChangesPanelOpen, controller.visualComparePanelOpen
    ]) open.value = true
    await nextTick()

    expect(dockedPanels()).toEqual([
      'quality-audit-panel-title', 'accessibility-panel-title', 'performance-panel-title',
      'design-overview-panel-title', 'page-metadata-panel-title', 'security-panel-title',
      'coverage-panel-title', 'cpu-profile-panel-title', 'memory-panel-title',
      'inspector-issues-title', 'debug-report-panel-title', 'repro-panel-title',
      'dom-changes-panel-title', 'visual-compare-panel-title'
    ])
    view.unmount()
    controller.dispose()
  })

  it('loads and describes DOM changes when the panel opens, then closes through the controller', async () => {
    const manageDomChanges = vi.fn(async () => domChangesReport())
    const controller = createController(activeTab(), { manageDomChanges })
    const view = render(DomChangesPanel, { global, props: { dock: 'right', controller, locale: 'en-US' } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    controller.domChangesPanelOpen.value = true
    const panel = await screen.findByRole('dialog', { name: 'DOM changes' })
    expect(await within(panel).findByText('aria-expanded changed 3 times')).toBeVisible()
    expect(manageDomChanges).toHaveBeenCalledWith('get', 'tab-1')
    expect(panel).toHaveTextContent('Text content changed (content not recorded)')
    expect(panel).toHaveTextContent('2 added · 1 removed')
    expect(panel).toHaveTextContent('Added tags: li')
    expect(panel).toHaveTextContent('6 mutations · 3 grouped entries')

    const user = userEvent.setup()
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Dock DOM changes' }), 'bottom')
    expect(view.emitted()['update:dock']?.at(-1)).toEqual(['bottom'])
    await user.click(within(panel).getByRole('button', { name: 'Close DOM changes' }))
    expect(controller.domChangesPanelOpen.value).toBe(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    view.unmount()
    controller.dispose()
  })

  it('counts repeated DOM changes in the form the interface language takes', async () => {
    // The repeat count kept one form for every number: "aria-expanded змінено 3 разів".
    const controller = createController(activeTab(), { manageDomChanges: vi.fn(async () => domChangesReport()) })
    const view = render(DomChangesPanel, { global: { plugins: [createHronautI18n('uk-UA')] }, props: { dock: 'right', controller, locale: 'uk-UA' } })
    controller.domChangesPanelOpen.value = true
    const panel = await screen.findByRole('dialog', { name: 'Зміни DOM' })
    expect(await within(panel).findByText('aria-expanded змінено 3 рази')).toBeVisible()
    view.unmount()
    controller.dispose()
  })

  it('keeps the debug report preservation toggle and incident review on the panel props', async () => {
    vi.stubGlobal('hronaut', {
      discardIncident: vi.fn(async () => undefined),
      invalidateIncidentPreview: vi.fn(async () => undefined)
    })
    const tab = activeTab({ preserveDiagnosticLogs: true })
    const controller = createController(tab)
    controller.debugReportPanelOpen.value = true
    controller.debugReportState.value = 'complete'
    controller.debugReport.value = debugReport()
    const updatePreservation = vi.fn()
    const view = render(DebugReportPanel, {
      global,
      props: { dock: 'right', activeTab: tab, locale: 'en-US', controller, preservationBusy: false, updatePreservation, keepsSeparatePanelOpen: () => false }
    })
    try {
      const panel = screen.getByRole('dialog', { name: 'Debug report' })
      expect(within(panel).getByText('fixture failure')).toBeVisible()
      expect(within(panel).getByText('404')).toBeVisible()
      expect(within(panel).getByText('net::ERR_BLOCKED_BY_CLIENT')).toBeVisible()
      expect(within(panel).getByText('Reviewed incident package')).toBeInTheDocument()

      const preserve = within(panel).getByRole('checkbox', { name: 'Preserve logs across page loads' })
      expect(preserve).toBeChecked()
      expect(getByTooltip('Keep bounded Network and Console evidence when this tab loads another page', panel)).toContainElement(preserve)
      await userEvent.setup().click(preserve)
      expect(updatePreservation).toHaveBeenCalledExactlyOnceWith(expect.any(Event))

      await view.rerender({ preservationBusy: true })
      expect(preserve).toBeDisabled()
    } finally {
      view.unmount()
      controller.dispose()
      vi.unstubAllGlobals()
    }
  })
})
