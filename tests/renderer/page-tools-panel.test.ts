import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PageToolsPanel from '../../src/renderer/src/components/PageToolsPanel.vue'
import { useDiagnosticsController } from '../../src/renderer/src/composables/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState } from '../../src/shared/types.js'

function tab(): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/page',
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

function renderPanel(captureBusy = false) {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const diagnostics = useDiagnosticsController({
    activeTab,
    browser: {} as never,
    translate: (key) => key,
    copyText: async () => true,
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen: () => false
  })
  const actions = {
    toggleSiteStorage: vi.fn(),
    toggleResponsivePreview: vi.fn(),
    toggleEnvironment: vi.fn(),
    toggleConsole: vi.fn(),
    toggleNetwork: vi.fn(),
    openRequestConditions: vi.fn(),
    toggleElementPicker: vi.fn(),
    copyPageSnapshot: vi.fn(),
    savePdf: vi.fn(),
    fillSavedPassword: vi.fn()
  }
  const labels = {
    responsive: 'No viewport override',
    environment: 'No overrides',
    inspectorIssues: 'No issues',
    security: 'Inspect transport security',
    debugReport: 'Collect a debug report',
    repro: 'Record a reproduction',
    domChanges: 'Record DOM changes',
    visualCompare: 'Compare screenshots',
    contextPicker: 'Pick element context',
    elementScreenshot: 'Capture one element',
    qualityAudit: 'Run quality audit',
    accessibilityAudit: 'Run accessibility audit',
    performance: 'Measure performance',
    designOverview: 'Inspect design',
    pageMetadata: 'Inspect metadata',
    coverage: 'Record coverage',
    cpuProfile: 'Record CPU profile',
    memory: 'Measure memory',
    pdfExport: 'Save page as PDF'
  }
  const view = render(PageToolsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      dock: 'right',
      activeTab: activeTab.value,
      activeWebUrl: activeTab.value!.url,
      hostname: 'example.test',
      locale: 'en-US',
      environmentState: 'idle',
      environmentOverrideCount: 0,
      networkRouteCount: 2,
      inspectorIssueCount: 0,
      debugReportSignalCount: 0,
      elementPickerState: 'idle',
      elementPickerMode: 'context',
      captureBusy,
      snapshotState: 'idle',
      pdfState: 'idle',
      credentialStorageAvailable: true,
      credentialCount: 1,
      diagnostics,
      labels,
      actions
    }
  })
  return { view, actions, diagnostics }
}

describe('PageToolsPanel', () => {
  it('owns page-tool rendering and dispatches export and picker actions', async () => {
    const { view, actions, diagnostics } = renderPanel()
    const user = userEvent.setup()

    expect(screen.getByRole('dialog', { name: 'Page tools' })).toBeVisible()
    expect(screen.getByText('2 active')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Copy page snapshot for agent' }))
    await user.click(screen.getByRole('button', { name: 'Pick element context' }))

    expect(actions.copyPageSnapshot).toHaveBeenCalledOnce()
    expect(actions.toggleElementPicker).toHaveBeenCalledWith('context')
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
    diagnostics.dispose()
  })

  it('emits dock and close model changes', async () => {
    const { view, diagnostics } = renderPanel()
    const user = userEvent.setup()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Dock page tools' }), 'bottom')
    await user.click(screen.getByRole('button', { name: 'Close page tools' }))

    expect(view.emitted()['update:dock']?.at(-1)).toEqual(['bottom'])
    expect(view.emitted()['update:open']?.at(-1)).toEqual([false])
    diagnostics.dispose()
  })

  it('keeps both element pickers disabled while a page screenshot is capturing', () => {
    const { diagnostics } = renderPanel(true)

    expect(screen.getByRole('button', { name: 'Pick element context' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Capture one element' })).toBeDisabled()
    diagnostics.dispose()
  })
})
