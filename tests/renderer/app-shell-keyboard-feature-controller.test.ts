import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellKeyboardFeatureController } from '../../src/renderer/src/composables/useAppShellKeyboardFeatureController.js'

function createHarness() {
  const surfaces = {
    commandPalette: ref(false),
    walletApproval: ref(false),
    workspaceEditor: ref(false),
    credentialPicker: ref(false),
    helpDialog: ref(false),
    releaseHistory: ref(false),
    settings: ref(false),
    siteStorage: ref(false),
    siteControls: ref(false),
    addressSuggestions: ref(false),
    find: ref(false),
    tabSearch: ref(false),
    splitMenu: ref(false),
    zoom: ref(false),
    updateNotice: ref(false),
    downloads: ref(false),
    bookmarks: ref(false),
    history: ref(false),
    pageTools: ref(false),
    accessibility: ref(false),
    qualityAudit: ref(false),
    performance: ref(false),
    designOverview: ref(false),
    pageMetadata: ref(false),
    security: ref(false),
    coverage: ref(false),
    cpuProfile: ref(false),
    memory: ref(false),
    console: ref(false),
    debugReport: ref(false),
    repro: ref(false),
    domChanges: ref(false),
    visualCompare: ref(false),
    inspectorIssues: ref(false),
    network: ref(false),
    responsivePreview: ref(false),
    environment: ref(false),
    areaCaptureState: ref<'idle' | 'picking'>('idle'),
    elementPickerState: ref<'idle' | 'picking'>('idle')
  }
  const actions = {
    closeWorkspaceEditor: vi.fn(() => { surfaces.workspaceEditor.value = false }),
    closeHelpDialog: vi.fn(() => { surfaces.helpDialog.value = false }),
    closeReleaseHistory: vi.fn(() => { surfaces.releaseHistory.value = false }),
    closeSettings: vi.fn(() => { surfaces.settings.value = false }),
    closeFind: vi.fn(() => { surfaces.find.value = false }),
    closeBookmarks: vi.fn(() => { surfaces.bookmarks.value = false }),
    closeResponsivePreview: vi.fn(() => { surfaces.responsivePreview.value = false }),
    toggleAreaCapture: vi.fn(async () => { surfaces.areaCaptureState.value = 'idle' }),
    cancelElementPicker: vi.fn(async () => { surfaces.elementPickerState.value = 'idle' }),
    runShortcut: vi.fn()
  }
  const controller = useAppShellKeyboardFeatureController({
    allInteractionLocked: () => false,
    commandPalette: surfaces.commandPalette,
    modals: {
      walletApproval: { open: surfaces.walletApproval, close: () => undefined },
      workspaceEditor: { open: surfaces.workspaceEditor, close: actions.closeWorkspaceEditor },
      credentialPicker: surfaces.credentialPicker,
      helpDialog: { open: surfaces.helpDialog, close: actions.closeHelpDialog },
      releaseHistory: { open: surfaces.releaseHistory, close: actions.closeReleaseHistory },
      settings: { open: surfaces.settings, close: actions.closeSettings }
    },
    overlays: {
      siteStorage: surfaces.siteStorage,
      siteControls: surfaces.siteControls,
      addressSuggestions: surfaces.addressSuggestions,
      find: { open: surfaces.find, close: actions.closeFind },
      tabSearch: surfaces.tabSearch,
      splitMenu: surfaces.splitMenu,
      zoom: surfaces.zoom,
      updateNotice: surfaces.updateNotice
    },
    collections: {
      downloadsOpen: surfaces.downloads,
      bookmarksOpen: surfaces.bookmarks,
      bookmarksPanel: ref({
        handleEscape: actions.closeBookmarks,
        toggle: vi.fn(async () => undefined),
        toggleCurrent: vi.fn(async () => undefined)
      }),
      historyOpen: surfaces.history
    },
    pageTools: {
      panelOpen: surfaces.pageTools,
      accessibilityPanelOpen: surfaces.accessibility,
      qualityAuditPanelOpen: surfaces.qualityAudit,
      performancePanelOpen: surfaces.performance,
      designOverviewPanelOpen: surfaces.designOverview,
      pageMetadataPanelOpen: surfaces.pageMetadata,
      securityPanelOpen: surfaces.security,
      coveragePanelOpen: surfaces.coverage,
      cpuProfilePanelOpen: surfaces.cpuProfile,
      memoryPanelOpen: surfaces.memory,
      debugReportPanelOpen: surfaces.debugReport,
      reproPanelOpen: surfaces.repro,
      domChangesPanelOpen: surfaces.domChanges,
      visualComparePanelOpen: surfaces.visualCompare,
      inspectorIssuesOpen: surfaces.inspectorIssues,
      areaCaptureState: surfaces.areaCaptureState,
      elementPickerState: surfaces.elementPickerState,
      toggleAreaCapture: actions.toggleAreaCapture,
      cancelActiveElementPicker: actions.cancelElementPicker
    },
    developerPanels: { console: surfaces.console, network: surfaces.network },
    responsivePreview: {
      open: surfaces.responsivePreview,
      close: actions.closeResponsivePreview
    },
    environmentPanel: surfaces.environment,
    runShortcut: actions.runShortcut
  })
  return { controller, surfaces, actions }
}

describe('useAppShellKeyboardFeatureController', () => {
  it('owns the app modal and Escape priority, including custom component closers', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.workspaceEditor.value = true
    surfaces.credentialPicker.value = true
    surfaces.bookmarks.value = true
    surfaces.history.value = true

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(actions.closeWorkspaceEditor).toHaveBeenCalledOnce()
    expect(surfaces.credentialPicker.value).toBe(true)

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(surfaces.credentialPicker.value).toBe(false)

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(actions.closeBookmarks).toHaveBeenCalledOnce()
    expect(surfaces.history.value).toBe(true)

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(surfaces.history.value).toBe(false)
  })

  it('routes capture cancellation, command-palette dismissal, and browser shortcuts', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.areaCaptureState.value = 'picking'
    surfaces.elementPickerState.value = 'picking'

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(actions.toggleAreaCapture).toHaveBeenCalledOnce()
    expect(actions.cancelElementPicker).not.toHaveBeenCalled()

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(actions.cancelElementPicker).toHaveBeenCalledOnce()

    surfaces.commandPalette.value = true
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(surfaces.commandPalette.value).toBe(false)

    controller.handleKeyDown(new KeyboardEvent('keydown', {
      key: 'l',
      ctrlKey: true,
      cancelable: true
    }))
    expect(actions.runShortcut).toHaveBeenCalledOnce()
    expect(actions.runShortcut).toHaveBeenCalledWith('focus-address')
  })

  it('keeps browser shortcuts and Escape behind trusted wallet approval chrome', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.walletApproval.value = true
    const shortcut = new KeyboardEvent('keydown', {
      key: 'l', ctrlKey: true, cancelable: true
    })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    controller.handleKeyDown(shortcut)
    controller.handleKeyDown(escape)

    expect(actions.runShortcut).not.toHaveBeenCalled()
    expect(escape.defaultPrevented).toBe(true)
    expect(surfaces.walletApproval.value).toBe(true)
  })

  it('keeps browser shortcuts behind release history and closes it with Escape', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.releaseHistory.value = true
    const shortcut = new KeyboardEvent('keydown', {
      key: 'l', ctrlKey: true, cancelable: true
    })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    controller.handleKeyDown(shortcut)
    controller.handleKeyDown(escape)

    expect(actions.runShortcut).not.toHaveBeenCalled()
    expect(escape.defaultPrevented).toBe(true)
    expect(actions.closeReleaseHistory).toHaveBeenCalledOnce()
    expect(surfaces.releaseHistory.value).toBe(false)
  })
})
