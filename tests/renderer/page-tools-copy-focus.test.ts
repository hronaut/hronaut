import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PageToolsPanel from '../../src/renderer/src/features/page-tools/PageToolsPanel.vue'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import type { PageToolsLabels } from '../../src/renderer/src/features/page-tools/usePageToolsPresentationController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState } from '../../src/shared/types.js'

function tab(): BrowserTabState {
  return {
    id: 'tab-1', title: 'Example', url: 'https://example.test/page', loading: false, navigationGeneration: 0,
    canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false,
    preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function renderPanel(copyPageSnapshot: () => Promise<void>) {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const diagnostics = useDiagnosticsController({
    activeTab,
    browser: {} as never,
    translate: (key) => key,
    copyText: async () => true,
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen: () => false
  })
  const labels = Object.fromEntries([
    'responsive', 'environment', 'inspectorIssues', 'security', 'debugReport', 'repro', 'domChanges', 'visualCompare',
    'contextPicker', 'elementScreenshot', 'qualityAudit', 'accessibilityAudit', 'performance', 'designOverview',
    'pageMetadata', 'coverage', 'cpuProfile', 'memory', 'pdfExport'
  ].map((key) => [key, key])) as unknown as PageToolsLabels
  const view = render(PageToolsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true, dock: 'right', activeTab: activeTab.value, activeWebUrl: activeTab.value!.url, hostname: 'example.test',
      locale: 'en-US', environmentState: 'idle', environmentOverrideCount: 0, networkRouteCount: 0, inspectorIssueCount: 0,
      debugReportSignalCount: 0, elementPickerState: 'idle', elementPickerMode: 'context', captureBusy: false,
      snapshotState: 'idle', pdfState: 'idle', credentialStorageAvailable: true, credentialCount: 0, diagnostics, labels,
      actions: {
        toggleSiteStorage: vi.fn(), toggleResponsivePreview: vi.fn(), toggleEnvironment: vi.fn(), toggleConsole: vi.fn(),
        toggleNetwork: vi.fn(), openRequestConditions: vi.fn(), toggleElementPicker: vi.fn(), copyPageSnapshot,
        savePdf: vi.fn(), fillSavedPassword: vi.fn()
      }
    }
  })
  return { view, diagnostics }
}

// JSDOM keeps focus on a control that becomes disabled; Chromium moves it to the document body.
function dropFocusLikeChromium(control: HTMLElement): void {
  control.removeAttribute('disabled')
  control.blur()
  control.setAttribute('disabled', '')
  expect(document.body).toHaveFocus()
}

afterEach(() => vi.restoreAllMocks())

describe('PageToolsPanel focus after Copy page snapshot', () => {
  // Page tools stays open while the snapshot copies, with Copy page snapshot disabled, so Chromium moved its focus to
  // the document body: the next arrow key or Tab no longer moved through the tools.
  it.each(['copied', 'error'] as const)('gives the focus back to Copy page snapshot once it is %s', async (outcome) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const copying = deferred()
    const { view, diagnostics } = renderPanel(vi.fn(() => copying.promise))
    const copy = screen.getByRole('button', { name: 'Copy page snapshot for agent' })
    await userEvent.setup().click(copy)
    await view.rerender({ snapshotState: 'copying' })
    expect(copy).toBeDisabled()
    dropFocusLikeChromium(copy)

    await view.rerender({ snapshotState: outcome })
    copying.resolve()

    await vi.waitFor(() => expect(copy).toBeEnabled())
    await vi.waitFor(() => expect(copy).toHaveFocus())
    diagnostics.dispose()
    view.unmount()
  })

  it('leaves the focus alone when Page tools closed while the snapshot copied', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const copying = deferred()
    const { view, diagnostics } = renderPanel(vi.fn(() => copying.promise))
    const copy = screen.getByRole('button', { name: 'Copy page snapshot for agent' })
    await userEvent.setup().click(copy)
    await view.rerender({ snapshotState: 'copying' })
    dropFocusLikeChromium(copy)

    await view.rerender({ open: false, snapshotState: 'copied' })
    copying.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.body).toHaveFocus()
    diagnostics.dispose()
    view.unmount()
  })
})
