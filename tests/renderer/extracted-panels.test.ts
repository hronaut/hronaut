import { render, screen } from '@testing-library/vue'
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
  BrowserConsoleMessage,
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

describe('extracted diagnostic panels', () => {
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
        level: 'all',
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
