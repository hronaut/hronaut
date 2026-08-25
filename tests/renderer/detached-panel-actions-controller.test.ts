import { describe, expect, it, vi } from 'vitest'
import {
  useDetachedPanelActionsController,
  type DetachedPanelActionsControllerOptions
} from '../../src/renderer/src/composables/useDetachedPanelActionsController.js'
import type { DetachablePanelId } from '../../src/shared/types.js'

function createHarness() {
  const action = () => vi.fn(async (..._arguments: unknown[]) => undefined)
  const callbacks = {
    refreshSiteData: action(),
    refreshSiteStorage: action(),
    loadResponsiveDraft: action(),
    loadEnvironmentDraft: action(),
    runAccessibilityAudit: action(),
    runQualityAudit: action(),
    runPerformanceReport: action(),
    runDesignOverview: action(),
    runPageMetadata: action(),
    runSecurityReport: action(),
    manageCodeCoverage: action(),
    manageCpuProfile: action(),
    runMemoryReport: action(),
    refreshConsole: action(),
    refreshNetwork: action(),
    refreshNetworkRoutes: action(),
    runDebugReport: action(),
    manageRepro: action(),
    manageDomChanges: action(),
    manageVisualCompare: action(),
    refreshInspectorIssues: action()
  }
  const options = {
    refreshSiteData: callbacks.refreshSiteData,
    refreshSiteStorage: callbacks.refreshSiteStorage,
    loadResponsiveDraft: callbacks.loadResponsiveDraft,
    loadEnvironmentDraft: callbacks.loadEnvironmentDraft,
    diagnostics: {
      runAccessibilityAudit: callbacks.runAccessibilityAudit,
      runQualityAudit: callbacks.runQualityAudit,
      runPerformanceReport: callbacks.runPerformanceReport,
      runDesignOverview: callbacks.runDesignOverview,
      runPageMetadata: callbacks.runPageMetadata,
      runSecurityReport: callbacks.runSecurityReport,
      manageCodeCoverage: callbacks.manageCodeCoverage,
      manageCpuProfile: callbacks.manageCpuProfile,
      runMemoryReport: callbacks.runMemoryReport,
      runDebugReport: callbacks.runDebugReport,
      manageRepro: callbacks.manageRepro,
      manageDomChanges: callbacks.manageDomChanges,
      manageVisualCompare: callbacks.manageVisualCompare,
      refreshInspectorIssues: callbacks.refreshInspectorIssues
    },
    developerPanels: {
      refreshConsole: callbacks.refreshConsole,
      refreshNetwork: callbacks.refreshNetwork,
      refreshNetworkRoutes: callbacks.refreshNetworkRoutes
    }
  } as unknown as DetachedPanelActionsControllerOptions
  return {
    callbacks,
    controller: useDetachedPanelActionsController(options)
  }
}

describe('detached panel actions controller', () => {
  it.each([
    ['site-controls', 'refreshSiteData', []],
    ['site-storage', 'refreshSiteStorage', []],
    ['responsive-preview', 'loadResponsiveDraft', []],
    ['environment', 'loadEnvironmentDraft', []],
    ['accessibility', 'runAccessibilityAudit', []],
    ['quality-audit', 'runQualityAudit', []],
    ['performance', 'runPerformanceReport', []],
    ['design-overview', 'runDesignOverview', []],
    ['page-metadata', 'runPageMetadata', []],
    ['security', 'runSecurityReport', []],
    ['coverage', 'manageCodeCoverage', ['get']],
    ['cpu-profile', 'manageCpuProfile', ['get']],
    ['memory', 'runMemoryReport', []],
    ['console', 'refreshConsole', []],
    ['debug-report', 'runDebugReport', []],
    ['repro-recorder', 'manageRepro', ['get']],
    ['dom-changes', 'manageDomChanges', ['get']],
    ['visual-compare', 'manageVisualCompare', ['get']],
    ['issues', 'refreshInspectorIssues', []]
  ] as const)('routes %s refreshes to %s', async (panel, action, arguments_) => {
    const harness = createHarness()

    await harness.controller.refresh(panel)

    expect(harness.callbacks[action]).toHaveBeenCalledOnce()
    expect(harness.callbacks[action]).toHaveBeenCalledWith(...arguments_)
  })

  it('refreshes both network collections together', async () => {
    const harness = createHarness()

    await harness.controller.refresh('network')

    expect(harness.callbacks.refreshNetwork).toHaveBeenCalledOnce()
    expect(harness.callbacks.refreshNetworkRoutes).toHaveBeenCalledOnce()
  })

  it.each(['page-tools', 'bookmarks'] satisfies DetachablePanelId[])('%s needs no explicit refresh', async (panel) => {
    const harness = createHarness()

    await harness.controller.refresh(panel)

    expect(Object.values(harness.callbacks).every((callback) => callback.mock.calls.length === 0)).toBe(true)
  })
})
