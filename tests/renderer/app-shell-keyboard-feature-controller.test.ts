import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellKeyboardFeatureController } from '../../src/renderer/src/composables/useAppShellKeyboardFeatureController.js'
import { DETACHABLE_PANEL_IDS, type DetachablePanelId } from '../../src/shared/types.js'

function createHarness() {
  const surfaces = {
    commandPalette: ref(false),
    walletApproval: ref(false),
    trustedDialog: ref(false),
    agentSteps: ref(false),
    workspaceEditor: ref(false),
    credentialPicker: ref(false),
    helpDialog: ref(false),
    releaseHistory: ref(false),
    taskManager: ref(false),
    qrCode: ref(false),
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
    elementPickerState: ref<'idle' | 'picking'>('idle'),
    panelsInOwnWindow: ref(false)
  }
  const actions = {
    closeWorkspaceEditor: vi.fn(() => { surfaces.workspaceEditor.value = false }),
    closeHelpDialog: vi.fn(() => { surfaces.helpDialog.value = false }),
    closeReleaseHistory: vi.fn(() => { surfaces.releaseHistory.value = false }),
    closeTaskManager: vi.fn(() => { surfaces.taskManager.value = false }),
    closeQrCode: vi.fn(() => { surfaces.qrCode.value = false }),
    closeAgentSteps: vi.fn(() => { surfaces.agentSteps.value = false }),
    cancelTrustedDialog: vi.fn(() => { surfaces.trustedDialog.value = false }),
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
      trustedDialog: { open: surfaces.trustedDialog, close: actions.cancelTrustedDialog },
      agentSteps: { open: surfaces.agentSteps, close: actions.closeAgentSteps },
      workspaceEditor: { open: surfaces.workspaceEditor, close: actions.closeWorkspaceEditor },
      credentialPicker: surfaces.credentialPicker,
      helpDialog: { open: surfaces.helpDialog, close: actions.closeHelpDialog },
      releaseHistory: { open: surfaces.releaseHistory, close: actions.closeReleaseHistory },
      taskManager: { open: surfaces.taskManager, close: actions.closeTaskManager },
      qrCode: { open: surfaces.qrCode, close: actions.closeQrCode },
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
        toggleCurrent: vi.fn(async () => undefined),
        bookmarkAllTabs: vi.fn(async () => undefined)
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
    panelsInOwnWindow: () => surfaces.panelsInOwnWindow.value,
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

  it('leaves Site storage and Find open for an Escape that Find already handled', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.siteStorage.value = true
    surfaces.find.value = true
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    handled.preventDefault()

    controller.handleKeyDown(handled)

    expect(surfaces.siteStorage.value).toBe(true)
    expect(surfaces.find.value).toBe(true)
    expect(actions.closeFind).not.toHaveBeenCalled()
  })

  it('closes what is open in this window before a panel in its own window', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.panelsInOwnWindow.value = true
    surfaces.siteStorage.value = true
    surfaces.downloads.value = true
    surfaces.history.value = true

    // Site storage comes first in the Escape order, but in its own window it waits for Downloads and History here.
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(surfaces.downloads.value).toBe(false)
    expect(surfaces.siteStorage.value).toBe(true)

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(surfaces.history.value).toBe(false)
    expect(surfaces.siteStorage.value).toBe(true)

    // With nothing else open here, Escape closes the panel in its own window.
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(surfaces.siteStorage.value).toBe(false)

    // Bookmarks in its own window waits for History, which comes after it in the Escape order.
    surfaces.bookmarks.value = true
    surfaces.history.value = true
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(surfaces.history.value).toBe(false)
    expect(actions.closeBookmarks).not.toHaveBeenCalled()
  })

  it('closes every surface of this window before each panel that can move to its own window', () => {
    // A panel added to the shell's Escape order is added here too, or the test does not compile.
    const panels: Record<DetachablePanelId, keyof ReturnType<typeof createHarness>['surfaces']> = {
      'site-controls': 'siteControls',
      'site-storage': 'siteStorage',
      'page-tools': 'pageTools',
      'responsive-preview': 'responsivePreview',
      environment: 'environment',
      accessibility: 'accessibility',
      'quality-audit': 'qualityAudit',
      performance: 'performance',
      'design-overview': 'designOverview',
      'page-metadata': 'pageMetadata',
      security: 'security',
      coverage: 'coverage',
      'cpu-profile': 'cpuProfile',
      memory: 'memory',
      console: 'console',
      network: 'network',
      'debug-report': 'debugReport',
      'repro-recorder': 'repro',
      'dom-changes': 'domChanges',
      'visual-compare': 'visualCompare',
      issues: 'inspectorIssues',
      bookmarks: 'bookmarks'
    }
    type Surfaces = ReturnType<typeof createHarness>['surfaces']
    const inThisWindow: Array<{ name: string, open: (surfaces: Surfaces) => void, isOpen: (surfaces: Surfaces) => boolean }> = [
      ...(['addressSuggestions', 'find', 'splitMenu', 'zoom', 'downloads', 'history', 'updateNotice'] as const).map(name => ({
        name,
        open: (surfaces: Surfaces) => { surfaces[name].value = true },
        isOpen: (surfaces: Surfaces) => surfaces[name].value
      })),
      ...(['areaCaptureState', 'elementPickerState'] as const).map(name => ({
        name,
        open: (surfaces: Surfaces) => { surfaces[name].value = 'picking' },
        isOpen: (surfaces: Surfaces) => surfaces[name].value === 'picking'
      }))
    ]
    expect(Object.keys(panels).sort()).toEqual([...DETACHABLE_PANEL_IDS].sort())
    for (const panel of DETACHABLE_PANEL_IDS) {
      for (const surface of inThisWindow) {
        const { controller, surfaces } = createHarness()
        surfaces.panelsInOwnWindow.value = true
        surfaces[panels[panel]].value = true
        surface.open(surfaces)

        controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))

        expect({ panel, surface: surface.name, closed: !surface.isOpen(surfaces), panelOpen: surfaces[panels[panel]].value })
          .toEqual({ panel, surface: surface.name, closed: true, panelOpen: true })
      }
    }
  })

  it('keeps the Escape order for panels docked in this window', () => {
    const { controller, surfaces } = createHarness()
    surfaces.siteStorage.value = true
    surfaces.downloads.value = true

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(surfaces.siteStorage.value).toBe(false)
    expect(surfaces.downloads.value).toBe(true)
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

  it('keeps browser shortcuts behind a permission dialog and answers it as Cancel on Escape, once per press', () => {
    // A website's permission request now appears as Hronaut's own dialog. A shortcut must not act on the page behind
    // it, and Escape answers it as the system dialog's Cancel did; a held Escape's repeats do not reach what is under it.
    const { controller, surfaces, actions } = createHarness()
    surfaces.trustedDialog.value = true
    surfaces.find.value = true
    const shortcut = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, cancelable: true })
    const repeat = new KeyboardEvent('keydown', { key: 'Escape', repeat: true, cancelable: true })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    controller.handleKeyDown(shortcut)
    controller.handleKeyDown(repeat)
    expect(actions.runShortcut).not.toHaveBeenCalled()
    expect(repeat.defaultPrevented).toBe(true)
    expect(actions.cancelTrustedDialog).not.toHaveBeenCalled()

    controller.handleKeyDown(escape)
    expect(actions.cancelTrustedDialog).toHaveBeenCalledOnce()
    expect(surfaces.find.value).toBe(true)
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

  it('keeps browser shortcuts behind the Task manager and closes it with Escape or Shift+Escape', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.taskManager.value = true
    const shortcut = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, cancelable: true })
    // Shift+Escape is the menu's key for the Task manager elsewhere than macOS: under its dialog it closes it.
    const menuKey = new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, cancelable: true })

    controller.handleKeyDown(shortcut)
    controller.handleKeyDown(menuKey)

    expect(actions.runShortcut).not.toHaveBeenCalled()
    expect(shortcut.defaultPrevented).toBe(true)
    expect(menuKey.defaultPrevented).toBe(true)
    expect(actions.closeTaskManager).toHaveBeenCalledOnce()
    expect(surfaces.taskManager.value).toBe(false)

    surfaces.taskManager.value = true
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    controller.handleKeyDown(escape)
    expect(actions.closeTaskManager).toHaveBeenCalledTimes(2)
    expect(surfaces.taskManager.value).toBe(false)
  })

  it('keeps browser shortcuts behind the QR code dialog and closes it with Escape', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.qrCode.value = true
    const shortcut = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, cancelable: true })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    controller.handleKeyDown(shortcut)
    controller.handleKeyDown(escape)

    expect(actions.runShortcut).not.toHaveBeenCalled()
    expect(shortcut.defaultPrevented).toBe(true)
    expect(escape.defaultPrevented).toBe(true)
    expect(actions.closeQrCode).toHaveBeenCalledOnce()
    expect(surfaces.qrCode.value).toBe(false)
  })

  it('keeps browser shortcuts behind an agent\'s All steps and closes it with Escape', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.agentSteps.value = true
    const shortcut = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, cancelable: true })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    controller.handleKeyDown(shortcut)
    controller.handleKeyDown(escape)

    expect(actions.runShortcut).not.toHaveBeenCalled()
    expect(escape.defaultPrevented).toBe(true)
    expect(actions.closeAgentSteps).toHaveBeenCalledOnce()
    expect(surfaces.agentSteps.value).toBe(false)
  })

  it('keeps browser shortcuts behind the modal tab overview and closes it with Escape', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.tabSearch.value = true
    const shortcut = new KeyboardEvent('keydown', {
      key: 'l', ctrlKey: true, cancelable: true
    })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    controller.handleKeyDown(shortcut)
    expect(actions.runShortcut).not.toHaveBeenCalled()
    expect(surfaces.tabSearch.value).toBe(true)

    controller.handleKeyDown(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(surfaces.tabSearch.value).toBe(false)
  })

  it('lets the Search tabs shortcut toggle its own modal closed', () => {
    const { controller, surfaces, actions } = createHarness()
    surfaces.tabSearch.value = true
    const shortcut = new KeyboardEvent('keydown', {
      key: 'a', ctrlKey: true, shiftKey: true, cancelable: true
    })

    controller.handleKeyDown(shortcut)

    expect(shortcut.defaultPrevented).toBe(true)
    expect(surfaces.tabSearch.value).toBe(false)
    expect(actions.runShortcut).not.toHaveBeenCalled()
  })
})
