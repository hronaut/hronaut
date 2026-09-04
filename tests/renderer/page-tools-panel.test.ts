import { fireEvent, render, screen } from '@testing-library/vue'
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

function renderPanel(captureBusy = false, locale: 'en-US' | 'uk-UA' = 'en-US') {
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
    global: { plugins: [createHronautI18n(locale)] },
    props: {
      open: true,
      dock: 'right',
      activeTab: activeTab.value,
      activeWebUrl: activeTab.value!.url,
      hostname: 'example.test',
      locale,
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
  it('filters translated labels and existing tool keywords while hiding empty groups', async () => {
    const { diagnostics } = renderPanel()
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox', { name: 'Search page tools' })

    expect(screen.getByRole('status')).toHaveTextContent('25 of 25 tools')
    const content = document.getElementById('page-tools-content')!
    content.scrollTop = 400
    await user.type(search, '  INDEXEDdb  ')
    expect(content.scrollTop).toBe(0)
    expect(screen.getByRole('button', { name: 'Site storage for example.test' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('1 of 25 tools')
    expect(screen.queryByRole('heading', { name: 'Audit & optimize' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Console' })).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'export account')
    expect(screen.getByRole('status')).toHaveTextContent('3 of 25 tools')
    diagnostics.dispose()
  })

  it('supports keyboard entry to results, skips disabled tools, and clears without closing', async () => {
    const { view, actions, diagnostics } = renderPanel()
    const user = userEvent.setup()
    await view.rerender({ activeWebUrl: null })
    const search = screen.getByRole('searchbox', { name: 'Search page tools' })
    await user.click(search)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: 'Responsive preview: No viewport override' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(actions.toggleResponsivePreview).toHaveBeenCalledOnce()
    await user.click(search)
    await user.type(search, 'does-not-exist')
    expect(screen.getByText('No matching tools')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('0 of 25 tools')
    await user.keyboard('{ArrowDown}')
    expect(search).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(search).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('25 of 25 tools')
    expect(view.emitted()['update:open']).toBeUndefined()
    diagnostics.dispose()
  })

  it('keeps composition keys intact and restores all tools after closing and reopening', async () => {
    const { view, diagnostics } = renderPanel()
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox', { name: 'Search page tools' })
    await user.type(search, 'pdf')
    await fireEvent.keyDown(search, { key: 'Escape', isComposing: true })
    expect(search).toHaveValue('pdf')
    await fireEvent.keyDown(search, { key: 'ArrowDown', keyCode: 229 })
    expect(search).toHaveFocus()
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    expect(screen.getByRole('searchbox', { name: 'Search page tools' })).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('25 of 25 tools')
    diagnostics.dispose()
  })

  it('searches Ukrainian names and offers an explicit empty-state recovery action', async () => {
    const { diagnostics } = renderPanel(false, 'uk-UA')
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox', { name: 'Пошук інструментів сторінки' })
    await user.type(search, 'Зберегти')
    expect(screen.getByRole('status')).toHaveTextContent('1 із 25 інструментів')
    await user.clear(search)
    await user.type(search, 'немає-такого-інструмента')
    await user.click(screen.getAllByRole('button', { name: 'Очистити пошук' })[1])
    expect(search).toHaveFocus()
    expect(search).toHaveValue('')
    diagnostics.dispose()
  })

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
