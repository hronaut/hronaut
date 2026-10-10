import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import ConsolePanel from '../../src/renderer/src/components/ConsolePanel.vue'
import DiagnosticsPanels from '../../src/renderer/src/components/DiagnosticsPanels.vue'
import NetworkContentSearch from '../../src/renderer/src/components/NetworkContentSearch.vue'
import NetworkPanel from '../../src/renderer/src/components/NetworkPanel.vue'
import SiteStorageChangesView from '../../src/renderer/src/components/SiteStorageChangesView.vue'
import SiteStorageUsageView from '../../src/renderer/src/components/SiteStorageUsageView.vue'
import { useDiagnosticsController } from '../../src/renderer/src/composables/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type {
  BrowserAccessibilityAudit,
  BrowserConsoleMessage,
  BrowserNetworkBody,
  BrowserNetworkRequestDetails,
  BrowserNetworkSearchResult,
  BrowserStorageChangesReport,
  BrowserStorageUsageReport,
  BrowserTabState
} from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

function activeTab(): BrowserTabState {
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
    devToolsOpen: false
  }
}

function accessibilityAudit(action: BrowserAccessibilityAudit['action'] = 'measure'): BrowserAccessibilityAudit {
  return {
    tabId: 'tab-1',
    url: 'https://example.test/app',
    title: 'Example',
    auditedAt: '2026-09-15T10:05:00.000Z',
    action,
    standard: 'wcag-aa',
    scope: { selector: null, maxViolations: 50, maxNodesPerViolation: 3 },
    engine: { name: 'axe-core', version: '4.13.0' },
    violationCount: 1,
    affectedNodeCount: 1,
    needsReviewCount: 0,
    passedRuleCount: 20,
    truncated: false,
    violations: [{
      id: 'image-alt',
      impact: 'critical',
      help: 'Images must have alternative text',
      helpUrl: 'https://deque.test/image-alt',
      description: 'Ensure images have alternative text',
      nodeCount: 1,
      nodes: [{ targets: ['#hero'], failureSummary: 'Fix the missing alt attribute' }]
    }],
    baseline: {
      auditedAt: '2026-09-15T10:00:00.000Z',
      url: 'https://example.test/app',
      standard: 'wcag-aa',
      scope: { selector: null, maxViolations: 50, maxNodesPerViolation: 3 },
      engine: { name: 'axe-core', version: '4.13.0' },
      violationCount: 1,
      visibleFindingCount: 1,
      truncated: false
    },
    ...(action === 'measure' ? {
      comparison: {
        comparable: true,
        sameUrl: true,
        sameScope: true,
        sameEngine: true,
        newFindings: [{ ruleId: 'image-alt', impact: 'critical', help: 'Images must have alternative text', targets: ['#hero'] }],
        remainingFindings: [],
        resolvedFindings: [{ ruleId: 'button-name', impact: 'critical', help: 'Buttons must have names', targets: ['#save'] }],
        caveats: []
      }
    } : {})
  }
}

describe('extracted diagnostic panels', () => {
  it('saves and presents an accessibility comparison with actionable finding groups', async () => {
    const tab = ref<BrowserTabState | undefined>(activeTab())
    const runAccessibilityAudit = vi.fn()
      .mockResolvedValueOnce(accessibilityAudit('set-baseline'))
      .mockResolvedValueOnce(accessibilityAudit())
      .mockResolvedValueOnce({ ...accessibilityAudit('clear-baseline'), baseline: undefined, comparison: undefined, baselineCleared: true })
    const browser = {
      measurePerformance: vi.fn(), inspectDesign: vi.fn(), inspectPageMetadata: vi.fn(), inspectSecurity: vi.fn(),
      manageCodeCoverage: vi.fn(), manageCpuProfile: vi.fn(), measureMemory: vi.fn(), createDebugReport: vi.fn(),
      manageRepro: vi.fn(), manageDomChanges: vi.fn(), visualCompare: vi.fn(), copyVisualDiff: vi.fn(),
      listInspectorIssues: vi.fn(), runAccessibilityAudit, runQualityAudit: vi.fn()
    }
    const controller = useDiagnosticsController({
      activeTab: tab,
      browser,
      translate: key => key,
      copyText: async () => true,
      closeTransientPanels: vi.fn(),
      keepsSeparatePanelOpen: () => false
    })
    await controller.runAccessibilityAudit('set-baseline')
    const view = render(DiagnosticsPanels, {
      global,
      props: {
        dock: 'right', activeTab: tab.value, locale: 'en-US', controller,
        openSupport: vi.fn(async () => undefined), preservationBusy: false, updatePreservation: vi.fn()
      }
    })
    const panel = screen.getByRole('dialog', { name: 'Accessibility' })
    expect(panel).toHaveTextContent('Run the audit again after your change')
    expect(runAccessibilityAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'set-baseline', tabId: 'tab-1' }))

    await controller.runAccessibilityAudit()
    expect(panel).toHaveTextContent('New findings')
    expect(panel).toHaveTextContent('Images must have alternative text · image-alt')
    expect(panel).toHaveTextContent('Buttons must have names · button-name')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear baseline' }))
    expect(runAccessibilityAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'clear-baseline', tabId: 'tab-1' }))
    expect(screen.queryByText('Accessibility baseline')).not.toBeInTheDocument()
    view.unmount()
    controller.dispose()
  })

  it('owns the shared diagnostic panel shell and closes its active report', async () => {
    const tab = ref<BrowserTabState | undefined>(activeTab())
    const browser = {
      measurePerformance: vi.fn(),
      inspectDesign: vi.fn(),
      inspectPageMetadata: vi.fn(),
      inspectSecurity: vi.fn(),
      manageCodeCoverage: vi.fn(),
      manageCpuProfile: vi.fn(),
      measureMemory: vi.fn(),
      createDebugReport: vi.fn(),
      manageRepro: vi.fn(),
      manageDomChanges: vi.fn(),
      visualCompare: vi.fn(),
      copyVisualDiff: vi.fn(),
      listInspectorIssues: vi.fn(),
      runAccessibilityAudit: vi.fn(),
      runQualityAudit: vi.fn()
    }
    const controller = useDiagnosticsController({
      activeTab: tab,
      browser,
      translate: (key) => key,
      copyText: async () => true,
      closeTransientPanels: vi.fn(),
      keepsSeparatePanelOpen: () => false
    })
    controller.qualityAuditPanelOpen.value = true
    const view = render(DiagnosticsPanels, {
      global,
      props: {
        dock: 'right',
        activeTab: tab.value,
        locale: 'en-US',
        controller,
        openSupport: vi.fn(async () => undefined),
        preservationBusy: false,
        updatePreservation: vi.fn()
      }
    })

    expect(screen.getByRole('dialog', { name: 'Quality audit' })).toBeVisible()
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Dock Quality audit' }), 'bottom')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close quality audit' }))

    expect(view.emitted()['update:dock']?.at(-1)).toEqual(['bottom'])
    expect(controller.qualityAuditPanelOpen.value).toBe(false)
    controller.dispose()
  })

  it.each([
    { available: true, text: 'safe prefix\n[truncated after 20000 characters]', truncated: true, redacted: true },
    { available: true, text: '' },
    { available: false, reason: 'Response is no longer available' },
    { available: true }
  ] satisfies BrowserNetworkBody[])('copies exactly the displayed response when available: %j', async body => {
    const details: BrowserNetworkRequestDetails = {
      id: 'response-copy', url: 'https://example.test/api', method: 'GET', resourceType: 'fetch',
      startedAt: '2026-08-21T12:00:00.000Z', status: 200, detailsAvailable: true,
      request: { headers: {} }, response: { headers: {}, body }
    }
    const getNetworkRequestDetails = vi.fn(async () => details)
    vi.stubGlobal('hronaut', { listNetworkRequests: vi.fn(async () => [details]), getNetworkRequestDetails })
    const copyText = vi.fn(async () => true)
    const view = render(NetworkPanel, {
      global,
      props: {
        open: true, dock: 'right', activeTab: activeTab(), locale: 'en-US', copyText,
        syncState: vi.fn(async (operation: Promise<unknown>) => { await operation }),
        preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
      }
    })
    try {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Refresh network requests' }))
      await user.click(await within(screen.getByRole('listbox', { name: 'Network requests' })).findByRole('option'))
      await user.click(await screen.findByText('Response body'))
      const button = screen.getByRole('button', { name: 'Copy sanitized response body' })
      if (body.available && typeof body.text === 'string') {
        expect(button).toBeEnabled()
        await user.click(button)
        expect(copyText).toHaveBeenCalledExactlyOnceWith(body.text, expect.any(Function))
        expect(screen.getByRole('button', { name: 'Copied response body' })).toBeVisible()
      } else {
        expect(button).toBeDisabled()
        await user.click(button)
        expect(copyText).not.toHaveBeenCalled()
      }
      expect(getNetworkRequestDetails).toHaveBeenCalledOnce()
    } finally { view.unmount(); vi.unstubAllGlobals() }
  })

  it('keeps selected-detail refresh reachable while loading and after failure', async () => {
    const details: BrowserNetworkRequestDetails = {
      id: 'refresh-one', url: 'https://example.test/api', method: 'GET', resourceType: 'fetch',
      startedAt: '2026-08-21T12:00:00.000Z', status: 200, detailsAvailable: true,
      request: { headers: {} }, response: { headers: {}, body: { available: true, text: 'first' } }
    }
    const getNetworkRequestDetails = vi.fn(async () => details)
    const replayNetworkRequest = vi.fn()
    vi.stubGlobal('hronaut', { listNetworkRequests: vi.fn(async () => [details]), getNetworkRequestDetails, replayNetworkRequest })
    const view = render(NetworkPanel, {
      global,
      props: {
        open: true, dock: 'right', activeTab: activeTab(), locale: 'en-US', copyText: vi.fn(async () => true),
        syncState: vi.fn(async (operation: Promise<unknown>) => { await operation }),
        preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
      }
    })
    try {
      const user = userEvent.setup()
      expect(screen.queryByRole('button', { name: 'Refresh selected request details' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Refresh network requests' }))
      await user.click(await within(screen.getByRole('listbox', { name: 'Network requests' })).findByRole('option'))
      const refresh = await screen.findByRole('button', { name: 'Refresh selected request details' })
      let reject!: (reason: Error) => void
      getNetworkRequestDetails.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
      await user.click(refresh)
      expect(refresh).toHaveFocus()
      expect(refresh).toHaveAttribute('aria-disabled', 'true')
      await user.click(refresh)
      expect(getNetworkRequestDetails).toHaveBeenCalledTimes(2)
      reject(new Error('Retained details temporarily unavailable'))
      await screen.findByText('Retained details temporarily unavailable')
      expect(refresh).toHaveFocus()
      expect(refresh).toHaveAttribute('aria-disabled', 'false')
      await user.click(refresh)
      await vi.waitFor(() => expect(getNetworkRequestDetails).toHaveBeenCalledTimes(3))
      expect(getNetworkRequestDetails).toHaveBeenLastCalledWith('tab-1', 'refresh-one', 20_000)
      expect(replayNetworkRequest).not.toHaveBeenCalled()
    } finally { view.unmount(); vi.unstubAllGlobals() }
  })

  it('owns the Network panel shell and content-search disclosure', async () => {
    const view = render(NetworkPanel, {
      global,
      props: {
        open: true,
        dock: 'right',
        activeTab: activeTab(),
        locale: 'en-US',
        copyText: vi.fn(async () => true),
        syncState: vi.fn(async (operation: Promise<unknown>) => { await operation }),
        preservationBusy: false,
        updatePreservation: vi.fn(),
        keepsSeparatePanelOpen: () => false
      }
    })
    const user = userEvent.setup()

    expect(screen.getByRole('dialog', { name: 'Network' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Search request content' }))
    expect(screen.getByRole('searchbox', { name: 'Search headers, payloads, responses, WebSocket text, and event streams' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close network monitor' }))

    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })

  it('keeps Console filtering, dock selection, copy, and close behavior in the component boundary', async () => {
    const message: BrowserConsoleMessage = {
      timestamp: '2026-08-21T12:00:00.000Z',
      level: 'error',
      message: 'fixture failure',
      lineNumber: 12,
      columnNumber: 4,
      sourceId: 'https://example.test/app.js'
    }
    const view = render(ConsolePanel, {
      global,
      props: {
        open: true,
        dock: 'right',
        search: '',
        excludeText: '',
        level: 'all',
        liveUpdatesPaused: false,
        state: 'ready',
        messages: [message],
        filteredMessages: [message],
        error: '',
        copied: null,
        copiedEntryKey: null,
        messageCounts: { error: 1, warning: 0, info: 0, verbose: 0 },
        eventCount: 1,
        filteredEventCount: 1,
        preserveLogs: false,
        preservationBusy: false,
        locale: 'en-US'
      }
    })
    const user = userEvent.setup()

    expect(screen.getByRole('dialog', { name: 'Console' })).toBeVisible()
    expect(screen.getByText('fixture failure')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Pause displayed updates' }))
    expect(view.emitted().toggleLiveUpdates).toEqual([[]])
    await view.rerender({ liveUpdatesPaused: true })
    expect(screen.getByRole('button', { name: 'Resume displayed updates' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Log collection continues with existing retention limits. Pending and missed message counts are unknown.')
    await view.rerender({ state: 'loading' })
    const resume = screen.getByRole('button', { name: 'Resume displayed updates' })
    expect(resume).not.toBeDisabled()
    expect(resume).toHaveAttribute('aria-disabled', 'true')
    expect(resume).toHaveFocus()
    await user.keyboard('{Enter} ')
    await user.click(resume)
    expect(view.emitted().toggleLiveUpdates).toEqual([[]])
    await view.rerender({ state: 'ready' })
    expect(resume).toHaveAttribute('aria-disabled', 'false')
    expect(resume).toHaveFocus()
    await user.type(screen.getByRole('searchbox', { name: 'Filter Console messages' }), 'fixture')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dock Console' }), 'window')
    await user.click(screen.getByRole('button', { name: 'Copy Console entry' }))
    await user.click(screen.getByRole('button', { name: 'Close Console' }))

    expect(view.emitted()['update:search']?.at(-1)).toEqual(['fixture'])
    expect(view.emitted()['update:dock']?.at(-1)).toEqual(['window'])
    expect(view.emitted().copyEntry?.at(-1)).toEqual([message])
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
  })

  it('submits and selects bounded network content-search results', async () => {
    const result: BrowserNetworkSearchResult = {
      tabId: 'tab-1',
      query: 'token',
      caseSensitive: false,
      searchedAt: '2026-08-21T12:00:00.000Z',
      availableRequestCount: 3,
      searchedRequestCount: 3,
      matchingRequestCount: 1,
      resultCount: 1,
      occurrenceCount: 1,
      unavailableResponseBodyCount: 0,
      truncated: false,
      matches: [{
        requestId: 'request-1',
        url: 'https://example.test/api/profile',
        method: 'GET',
        resourceType: 'xhr',
        status: 200,
        field: 'response-body',
        label: 'Response body',
        snippet: '…token…',
        occurrenceCount: 1
      }],
      caveats: []
    }
    const view = render(NetworkContentSearch, {
      global,
      props: { open: true, query: 'token', caseSensitive: false, state: 'complete', result, error: '', locale: 'en-US' }
    })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(screen.getByRole('button', { name: /Inspect matching request 1/ }))
    await user.click(screen.getByRole('button', { name: 'Close request content search' }))

    expect(view.emitted().search).toHaveLength(1)
    expect(view.emitted().select?.at(-1)).toEqual([result.matches[0]])
    expect(view.emitted().close).toHaveLength(1)
  })

  it('renders localized storage usage and delegates report copying', async () => {
    const report: BrowserStorageUsageReport = {
      tabId: 'tab-1',
      url: 'https://example.test/app',
      origin: 'https://example.test',
      capturedAt: '2026-08-21T12:00:00.000Z',
      source: 'chromium-quota',
      usage: 1_536,
      quota: 10_240,
      available: 8_704,
      usagePercent: 15,
      overrideActive: false,
      breakdown: [{ storageType: 'indexeddb', usage: 1_536 }],
      breakdownAvailable: true,
      caveats: ['Aggregate values only.']
    }
    const view = render(SiteStorageUsageView, {
      global,
      props: { state: 'ready', report, error: '', copied: false, locale: 'en-US' }
    })

    expect(screen.getAllByText('1.5 KB')).toHaveLength(2)
    expect(screen.getByText('IndexedDB')).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: /Copy report/ }))
    expect(view.emitted().copy).toHaveLength(1)
  })

  it('delegates baseline creation from the empty storage-changes state', async () => {
    const report: BrowserStorageChangesReport = {
      tabId: 'tab-1',
      url: 'https://example.test/app',
      origin: 'https://example.test',
      action: 'get',
      status: 'empty',
      changeCount: 0,
      counts: { added: 0, updated: 0, removed: 0 },
      changes: [],
      valuesIncluded: false,
      caveats: []
    }
    const view = render(SiteStorageChangesView, {
      global,
      props: { state: 'ready', report, error: '', copied: false, locale: 'en-US' }
    })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Set baseline' }))
    expect(view.emitted().manage?.at(-1)).toEqual(['baseline'])
  })
})
