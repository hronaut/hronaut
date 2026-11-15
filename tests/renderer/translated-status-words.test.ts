import { cleanup, render, screen, within } from '@testing-library/vue'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PwaLifecyclePanel from '../../src/renderer/src/components/PwaLifecyclePanel.vue'
import SiteStorageChangesView from '../../src/renderer/src/features/site-storage/SiteStorageChangesView.vue'
import SiteStoragePwaView from '../../src/renderer/src/features/site-storage/SiteStoragePwaView.vue'
import CodeCoveragePanel from '../../src/renderer/src/features/diagnostics/code-coverage/CodeCoveragePanel.vue'
import DomChangesPanel from '../../src/renderer/src/features/diagnostics/dom-changes/DomChangesPanel.vue'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { PwaLifecycleReport } from '../../src/shared/pwa-lifecycle.js'
import type { BrowserCodeCoverageResult, BrowserDomChangesReport, BrowserPwaReport, BrowserStorageChangesReport, BrowserTabState } from '../../src/shared/types.js'

// These panels showed the words the main process and the page report, such as "added", "child-list", "block" and
// "activated", in an interface that is otherwise German.

type DiagnosticsBrowser = Parameters<typeof useDiagnosticsController>[0]['browser']

const german = { plugins: [createHronautI18n('de-DE')] }
const disposers: Array<() => void> = []
const originalHronaut = Object.getOwnPropertyDescriptor(window, 'hronaut')

afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0)) dispose()
  if (originalHronaut) Object.defineProperty(window, 'hronaut', originalHronaut)
  else Reflect.deleteProperty(window, 'hronaut')
})

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

function createController(overrides: Partial<DiagnosticsBrowser>) {
  const browser: DiagnosticsBrowser = {
    measurePerformance: vi.fn(), inspectDesign: vi.fn(), inspectPageMetadata: vi.fn(), inspectSecurity: vi.fn(),
    manageCodeCoverage: vi.fn(), manageCpuProfile: vi.fn(), measureMemory: vi.fn(), createDebugReport: vi.fn(),
    manageRepro: vi.fn(), manageDomChanges: vi.fn(), visualCompare: vi.fn(), copyVisualDiff: vi.fn(),
    listInspectorIssues: vi.fn(), runAccessibilityAudit: vi.fn(), runQualityAudit: vi.fn(),
    ...overrides
  }
  const controller = useDiagnosticsController({
    activeTab: ref<BrowserTabState | undefined>(activeTab()),
    browser,
    translate: key => key,
    copyText: async () => true,
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen: () => false
  })
  disposers.push(() => controller.dispose())
  return controller
}

describe('status words in the interface language', () => {
  it('names each tracked storage change', () => {
    const report: BrowserStorageChangesReport = {
      tabId: 'tab-1', url: 'https://example.test/app', origin: 'https://example.test', action: 'compare', status: 'compared',
      changeCount: 3, counts: { added: 1, updated: 1, removed: 1 }, valuesIncluded: false, caveats: [],
      changes: [
        { kind: 'local-storage', type: 'added', key: 'theme', afterValueBytes: 4 },
        { kind: 'session-storage', type: 'updated', key: 'draft', beforeValueBytes: 2, afterValueBytes: 6 },
        { kind: 'cookies', type: 'removed', key: 'session', domain: 'example.test', path: '/', beforeValueBytes: 8 }
      ]
    }
    const { container } = render(SiteStorageChangesView, { global: german, props: { state: 'ready', report, error: '', copied: false, locale: 'de-DE' } })

    expect([...container.querySelectorAll('.storage-change-type')].map(badge => badge.textContent)).toEqual(['hinzugefügt', 'aktualisiert', 'entfernt'])
  })

  it('names each kind of DOM change', async () => {
    const report: BrowserDomChangesReport = {
      tabId: 'tab-1', title: 'Example', url: 'https://example.test/app', startedAt: '2026-09-15T10:00:00.000Z', stoppedAt: '2026-09-15T10:00:05.000Z',
      active: false, changeCount: 3, truncated: false, droppedChanges: 0, caveats: [],
      summary: { childList: 1, attributes: 1, text: 1, addedNodes: 1, removedNodes: 0 },
      entries: [
        { index: 1, kind: 'attributes', occurredAt: '2026-09-15T10:00:01.000Z', elapsedMs: 120, target: 'main > button', occurrences: 1, attributeName: 'aria-expanded' },
        { index: 2, kind: 'text', occurredAt: '2026-09-15T10:00:02.000Z', elapsedMs: 240, target: 'main > p', occurrences: 1 },
        { index: 3, kind: 'child-list', occurredAt: '2026-09-15T10:00:03.000Z', elapsedMs: 360, target: 'main > ul', occurrences: 1, addedNodes: 1, addedTags: ['li'] }
      ]
    }
    const controller = createController({ manageDomChanges: vi.fn(async () => report) })
    render(DomChangesPanel, { global: german, props: { dock: 'right', controller, locale: 'de-DE' } })
    controller.domChangesPanelOpen.value = true
    const panel = await screen.findByRole('dialog', { name: 'DOM-Änderungen' })
    await within(panel).findByText('main > ul')

    expect([...panel.querySelectorAll('.repro-step header strong')].map(kind => kind.textContent)).toEqual(['Attribute', 'Text', 'Kindelemente'])
  })

  it('names the coverage precision while recording and in the report', async () => {
    const recording: BrowserCodeCoverageResult = {
      tabId: 'tab-1', url: 'https://example.test/app', title: 'Example', action: 'get', status: 'recording',
      recording: { startedAt: '2026-09-15T10:00:00.000Z', startedUrl: 'https://example.test/app', mode: 'block' }
    }
    const complete: BrowserCodeCoverageResult = {
      tabId: 'tab-1', url: 'https://example.test/app', title: 'Example', action: 'stop', status: 'complete',
      report: {
        startedAt: '2026-09-15T10:00:00.000Z', stoppedAt: '2026-09-15T10:00:05.000Z', startedUrl: 'https://example.test/app', currentUrl: 'https://example.test/app',
        mode: 'function', totalBytes: 100, usedBytes: 40, unusedBytes: 60, usedPercent: 40,
        javascript: { resourceCount: 1, totalBytes: 100, usedBytes: 40, unusedBytes: 60 },
        css: { resourceCount: 0, totalBytes: 0, usedBytes: 0, unusedBytes: 0 },
        resources: [], truncated: false, caveats: []
      }
    }
    const manageCodeCoverage = vi.fn().mockResolvedValueOnce(recording).mockResolvedValueOnce(complete)
    const controller = createController({ manageCodeCoverage })
    render(CodeCoveragePanel, { global: german, props: { dock: 'right', controller, locale: 'de-DE', keepsSeparatePanelOpen: () => false } })
    controller.toggleCodeCoverage()
    const panel = await screen.findByRole('dialog', { name: 'Codeabdeckung' })

    expect(await within(panel).findByText(/^Modus „Block“ · gestartet /)).toBeVisible()
    await controller.manageCodeCoverage('stop')
    expect(await within(panel).findByText('Modus „Funktion“')).toBeVisible()
  })

  it('names service-worker events, states and the stop reason, keeping a word it does not know', async () => {
    const report: PwaLifecycleReport = {
      tabId: 'tab-1', captureId: 'capture-1', origin: 'https://example.test', active: false, reason: 'duration-limit', startedAt: 1, stoppedAt: 2,
      truncated: false, missingHistory: true, interrupted: false, lastDrainedAt: 2, coverage: 'observed-only', caveats: [],
      events: [
        { kind: 'statechange', observedAt: 1, scope: 'https://example.test/', worker: { id: 1, scriptUrl: 'https://example.test/sw.js', state: 'activated' }, controller: null },
        { kind: 'future-event', observedAt: 2, scope: 'https://example.test/', worker: { id: 2, scriptUrl: 'https://example.test/sw.js', state: 'future-state' }, controller: null },
        { kind: 'constructor', observedAt: 3, scope: 'https://example.test/', worker: { id: 3, scriptUrl: 'https://example.test/sw.js', state: '__proto__' }, controller: null }
      ]
    }
    Object.defineProperty(window, 'hronaut', { configurable: true, value: { pwaLifecycle: vi.fn(async () => report) } })
    render(PwaLifecyclePanel, { global: german, props: { tab: activeTab() } })

    expect(await screen.findByRole('status')).toHaveTextContent(/· Zwei-Minuten-Limit erreicht$/)
    const [known, unknown, inherited] = screen.getAllByRole('listitem')
    expect(known).toHaveTextContent(/· Status geändert · 1 aktiviert/)
    expect(unknown).toHaveTextContent(/· future-event · 2 future-state/)
    expect(inherited).toHaveTextContent(/· constructor · 3 __proto__/)
  })

  it('names the state of each registered service worker on the Offline tab', () => {
    const report: BrowserPwaReport = {
      tabId: 'tab-1', url: 'https://example.test/app', origin: 'https://example.test', capturedAt: '2026-09-15T10:00:00.000Z', supported: true,
      controlled: true, manifestInspectionAvailable: true, installabilityInspectionAvailable: true, caches: [], cacheInspectionAvailable: true, caveats: [],
      registrations: [
        { scope: 'https://example.test/', updateViaCache: 'imports', active: { scriptUrl: 'https://example.test/sw.js', state: 'activated' } },
        { scope: 'https://example.test/next/', updateViaCache: 'imports', waiting: { scriptUrl: 'https://example.test/next.js', state: 'future-state' } },
        { scope: 'https://example.test/idle/', updateViaCache: 'imports' }
      ]
    }
    const { container } = render(SiteStoragePwaView, { global: german, props: { state: 'ready', report, error: '', copied: false, offset: 0, locale: 'de-DE', cache: '', query: '' } })

    expect([...container.querySelectorAll('.pwa-registrations small')].map((line) => line.textContent?.split(' · ')[0]))
      .toEqual(['aktiviert', 'future-state', 'inaktiv'])
  })

})
