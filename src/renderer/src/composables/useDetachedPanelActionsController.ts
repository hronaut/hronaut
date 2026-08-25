import type { DetachablePanelId } from '../../../shared/types.js'
import type { DeveloperPanelsShellController } from './useDeveloperPanelsShellController.js'
import type { DiagnosticsController } from './useDiagnosticsController.js'

type DetachedDiagnostics = Pick<
  DiagnosticsController,
  | 'runAccessibilityAudit'
  | 'runQualityAudit'
  | 'runPerformanceReport'
  | 'runDesignOverview'
  | 'runPageMetadata'
  | 'runSecurityReport'
  | 'manageCodeCoverage'
  | 'manageCpuProfile'
  | 'runMemoryReport'
  | 'runDebugReport'
  | 'manageRepro'
  | 'manageDomChanges'
  | 'manageVisualCompare'
  | 'refreshInspectorIssues'
>

type DetachedDeveloperPanels = Pick<
  DeveloperPanelsShellController,
  'refreshConsole' | 'refreshNetwork' | 'refreshNetworkRoutes'
>

export interface DetachedPanelActionsControllerOptions {
  refreshSiteData: () => unknown
  refreshSiteStorage: () => unknown
  loadResponsiveDraft: () => unknown
  loadEnvironmentDraft: () => unknown
  diagnostics: DetachedDiagnostics
  developerPanels: DetachedDeveloperPanels
}

export function useDetachedPanelActionsController(options: DetachedPanelActionsControllerOptions) {
  async function refresh(panel: DetachablePanelId): Promise<void> {
    switch (panel) {
      case 'site-controls': await options.refreshSiteData(); return
      case 'site-storage': await options.refreshSiteStorage(); return
      case 'responsive-preview': await options.loadResponsiveDraft(); return
      case 'environment': await options.loadEnvironmentDraft(); return
      case 'accessibility': await options.diagnostics.runAccessibilityAudit(); return
      case 'quality-audit': await options.diagnostics.runQualityAudit(); return
      case 'performance': await options.diagnostics.runPerformanceReport(); return
      case 'design-overview': await options.diagnostics.runDesignOverview(); return
      case 'page-metadata': await options.diagnostics.runPageMetadata(); return
      case 'security': await options.diagnostics.runSecurityReport(); return
      case 'coverage': await options.diagnostics.manageCodeCoverage('get'); return
      case 'cpu-profile': await options.diagnostics.manageCpuProfile('get'); return
      case 'memory': await options.diagnostics.runMemoryReport(); return
      case 'console': await options.developerPanels.refreshConsole(); return
      case 'network':
        await Promise.all([
          options.developerPanels.refreshNetwork(),
          options.developerPanels.refreshNetworkRoutes()
        ])
        return
      case 'debug-report': await options.diagnostics.runDebugReport(); return
      case 'repro-recorder': await options.diagnostics.manageRepro('get'); return
      case 'dom-changes': await options.diagnostics.manageDomChanges('get'); return
      case 'visual-compare': await options.diagnostics.manageVisualCompare('get'); return
      case 'issues': await options.diagnostics.refreshInspectorIssues(); return
      case 'page-tools':
      case 'bookmarks':
        return
      default: {
        const unsupportedPanel: never = panel
        return unsupportedPanel
      }
    }
  }

  return { refresh }
}

export type DetachedPanelActionsController = ReturnType<typeof useDetachedPanelActionsController>
