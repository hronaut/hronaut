import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { COMMAND_PALETTE_COMMANDS } from '../../src/shared/command-palette.js'
import { useAppCommandPaletteFeatureController } from '../../src/renderer/src/composables/useAppCommandPaletteFeatureController.js'

function createHarness() {
  const methods = {
    openHome: vi.fn(),
    runShortcut: vi.fn(),
    toggleTabSearch: vi.fn(),
    openFind: vi.fn(),
    togglePageTools: vi.fn(),
    toggleDeveloperTools: vi.fn(),
    toggleDownloads: vi.fn(),
    toggleBookmarks: vi.fn(),
    toggleVisitHistory: vi.fn(),
    toggleResponsivePreview: vi.fn(),
    toggleEnvironment: vi.fn(),
    toggleAreaCapture: vi.fn(),
    toggleElementPicker: vi.fn(),
    capturePageScreenshot: vi.fn(),
    copyPageSnapshot: vi.fn(),
    toggleInspectorIssues: vi.fn(),
    toggleDebugReport: vi.fn(),
    toggleReproRecorder: vi.fn(),
    toggleDomChanges: vi.fn(),
    toggleVisualCompare: vi.fn(),
    toggleQualityAudit: vi.fn(),
    toggleAccessibilityAudit: vi.fn(),
    togglePerformanceReport: vi.fn(),
    toggleDesignOverview: vi.fn(),
    togglePageMetadata: vi.fn(),
    toggleSecurityReport: vi.fn(),
    toggleCodeCoverage: vi.fn(),
    toggleCpuProfile: vi.fn(),
    toggleMemoryReport: vi.fn(),
    toggleConsole: vi.fn(),
    toggleNetworkMonitor: vi.fn(),
    openRequestConditions: vi.fn(),
    toggleSiteStorage: vi.fn(),
    openPrivacySettings: vi.fn(),
    openUpdateSettings: vi.fn(),
    openSection: vi.fn(),
    openHelp: vi.fn(),
    toggleMcpPaused: vi.fn()
  }
  const open = ref(false)
  const beforeOpen = vi.fn()
  const panel = ref({
    openPanel: vi.fn(async () => { open.value = true }),
    close: vi.fn(() => { open.value = false })
  })
  const controller = useAppCommandPaletteFeatureController({
    open,
    panel,
    beforeOpen,
    browser: {
      openHome: methods.openHome,
      runShortcut: methods.runShortcut,
      toggleTabSearch: methods.toggleTabSearch,
      openFind: methods.openFind,
      togglePageTools: methods.togglePageTools,
      toggleDeveloperTools: methods.toggleDeveloperTools
    },
    collections: {
      toggleDownloads: methods.toggleDownloads,
      toggleBookmarks: methods.toggleBookmarks,
      toggleVisitHistory: methods.toggleVisitHistory
    },
    emulation: {
      toggleResponsivePreview: methods.toggleResponsivePreview,
      toggleEnvironment: methods.toggleEnvironment
    },
    pageTools: {
      toggleAreaCapture: methods.toggleAreaCapture,
      toggleElementPicker: methods.toggleElementPicker,
      capturePageScreenshot: methods.capturePageScreenshot,
      copyPageSnapshot: methods.copyPageSnapshot,
      toggleInspectorIssues: methods.toggleInspectorIssues,
      toggleDebugReport: methods.toggleDebugReport,
      toggleReproRecorder: methods.toggleReproRecorder,
      toggleDomChanges: methods.toggleDomChanges,
      toggleVisualCompare: methods.toggleVisualCompare,
      toggleQualityAudit: methods.toggleQualityAudit,
      toggleAccessibilityAudit: methods.toggleAccessibilityAudit,
      togglePerformanceReport: methods.togglePerformanceReport,
      toggleDesignOverview: methods.toggleDesignOverview,
      togglePageMetadata: methods.togglePageMetadata,
      toggleSecurityReport: methods.toggleSecurityReport,
      toggleCodeCoverage: methods.toggleCodeCoverage,
      toggleCpuProfile: methods.toggleCpuProfile,
      toggleMemoryReport: methods.toggleMemoryReport
    },
    panels: {
      toggleConsole: methods.toggleConsole,
      toggleNetworkMonitor: methods.toggleNetworkMonitor,
      openRequestConditions: methods.openRequestConditions
    },
    site: {
      toggleSiteStorage: methods.toggleSiteStorage,
      openPrivacySettings: methods.openPrivacySettings,
      openUpdateSettings: methods.openUpdateSettings
    },
    settings: {
      openSection: methods.openSection,
      openHelp: methods.openHelp,
      toggleMcpPaused: methods.toggleMcpPaused
    }
  })

  return { controller, methods, open, beforeOpen, panel }
}

describe('useAppCommandPaletteFeatureController', () => {
  it('owns command-palette opening and closing without changing shell cleanup order', async () => {
    const harness = createHarness()

    await harness.controller.toggle()

    expect(harness.beforeOpen).toHaveBeenCalledOnce()
    expect(harness.panel.value.openPanel).toHaveBeenCalledOnce()
    expect(harness.open.value).toBe(true)

    await harness.controller.toggle()

    expect(harness.beforeOpen).toHaveBeenCalledOnce()
    expect(harness.panel.value.close).toHaveBeenCalledOnce()
    expect(harness.open.value).toBe(false)
  })

  it('dispatches the complete app command catalog to its focused feature owners', async () => {
    const { controller, methods, open } = createHarness()

    for (const command of COMMAND_PALETTE_COMMANDS) {
      open.value = true
      await controller.run(command.id)
      expect(open.value).toBe(false)
    }

    expect(methods.runShortcut.mock.calls).toEqual([
      ['new-tab'],
      ['reload'],
      ['reload-ignoring-cache']
    ])
    expect(methods.toggleElementPicker.mock.calls).toEqual([['screenshot'], ['context']])
    expect(methods.capturePageScreenshot.mock.calls).toEqual([['viewport'], ['full-page']])
    expect(methods.openSection.mock.calls).toEqual([['appearance'], ['permissions'], ['mcp']])
    expect(methods.openHelp).toHaveBeenCalledOnce()
    expect(methods.openHelp).toHaveBeenCalledWith('shortcuts')

    const transformedMethods = new Set([
      'runShortcut',
      'toggleElementPicker',
      'capturePageScreenshot',
      'openSection'
    ])
    for (const [name, method] of Object.entries(methods)) {
      if (transformedMethods.has(name)) continue
      expect(method, `${name} should own one command`).toHaveBeenCalledOnce()
    }
  })
})
