import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type {
  BrowserAccessibilityAuditOptions,
  BrowserCodeCoverageOptions,
  BrowserCpuProfileOptions,
  BrowserDebugReportOptions,
  BrowserDesignOverviewReport,
  BrowserDomChangesAction,
  BrowserMemoryOptions,
  BrowserPageMetadataReport,
  BrowserPerformanceOptions,
  BrowserReproAction,
  BrowserSecurityReport,
  BrowserVisualCompareOptions
} from '../shared/types.js'

interface DiagnosticsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  tabs(): Pick<BrowserTabsManager,
    | 'accessibilityAudit'
    | 'codeCoverage'
    | 'cpuProfile'
    | 'debugReport'
    | 'designOverview'
    | 'domChanges'
    | 'getState'
    | 'inspectorIssues'
    | 'memoryReport'
    | 'pageMetadata'
    | 'performanceReport'
    | 'qualityAudit'
    | 'reproRecording'
    | 'securityReport'
    | 'setDiagnosticLogPreservation'
    | 'visualCompare'
    | 'visualDiff'
  >
  pngDataUrl(data: Buffer): string
  copyPng(data: Buffer): Promise<{ width: number; height: number }>
}

/** Keep services lazy: registration precedes browser-window initialization. */
export function registerDiagnosticsIpc(ipcMain: Pick<IpcMain, 'handle'>, host: DiagnosticsIpcHost): void {
  ipcMain.handle('browser:accessibility-audit', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid accessibility audit options')
    const { tabId, action, selector, standard, maxViolations, maxNodesPerViolation } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && !['measure', 'set-baseline', 'clear-baseline'].includes(String(action)))
      || (selector !== undefined && typeof selector !== 'string')
      || (standard !== undefined && !['wcag-aa', 'wcag-aaa', 'best-practice', 'all'].includes(String(standard)))
      || (maxViolations !== undefined && typeof maxViolations !== 'number')
      || (maxNodesPerViolation !== undefined && typeof maxNodesPerViolation !== 'number')
    ) {
      throw new TypeError('Invalid accessibility audit options')
    }
    return host.tabs().accessibilityAudit(value as BrowserAccessibilityAuditOptions)
  })
  ipcMain.handle('browser:quality-audit', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid quality audit tab')
    return host.tabs().qualityAudit(tabId)
  })
  ipcMain.handle('browser:performance', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid performance options')
    const { tabId, settleMs } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (settleMs !== undefined && typeof settleMs !== 'number')
    ) {
      throw new TypeError('Invalid performance options')
    }
    return host.tabs().performanceReport(value as BrowserPerformanceOptions)
  })
  ipcMain.handle('browser:design-overview', (event, tabId: unknown): Promise<BrowserDesignOverviewReport> => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid design overview tab')
    return host.tabs().designOverview(tabId)
  })
  ipcMain.handle('browser:page-metadata', (event, tabId: unknown): Promise<BrowserPageMetadataReport> => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid page metadata tab')
    return host.tabs().pageMetadata(tabId)
  })
  ipcMain.handle('browser:security', (event, tabId: unknown): BrowserSecurityReport => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid security report tab')
    return host.tabs().securityReport(tabId)
  })
  ipcMain.handle('browser:code-coverage', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid code coverage options')
    const { tabId, action, mode, reload } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && !['get', 'start', 'stop', 'clear'].includes(String(action)))
      || (mode !== undefined && !['function', 'block'].includes(String(mode)))
      || (reload !== undefined && typeof reload !== 'boolean')
    ) {
      throw new TypeError('Invalid code coverage options')
    }
    return host.tabs().codeCoverage(value as BrowserCodeCoverageOptions)
  })
  ipcMain.handle('browser:cpu-profile', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid JavaScript CPU profile options')
    const { tabId, action } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && !['get', 'start', 'stop', 'clear'].includes(String(action)))
    ) {
      throw new TypeError('Invalid JavaScript CPU profile options')
    }
    return host.tabs().cpuProfile(value as BrowserCpuProfileOptions)
  })
  ipcMain.handle('browser:memory', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid memory options')
    const { tabId, action, collectGarbage } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && ![
        'measure',
        'set-baseline',
        'clear-baseline',
        'start-allocation-sampling',
        'stop-allocation-sampling',
        'clear-allocation-sampling'
      ].includes(String(action)))
      || (collectGarbage !== undefined && typeof collectGarbage !== 'boolean')
    ) {
      throw new TypeError('Invalid memory options')
    }
    return host.tabs().memoryReport(value as BrowserMemoryOptions)
  })
  ipcMain.handle('browser:debug-report', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid debug report options')
    const { tabId, maxConsoleMessages, maxNetworkRequests, includeSuccessfulRequests } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (maxConsoleMessages !== undefined && typeof maxConsoleMessages !== 'number')
      || (maxNetworkRequests !== undefined && typeof maxNetworkRequests !== 'number')
      || (includeSuccessfulRequests !== undefined && typeof includeSuccessfulRequests !== 'boolean')
    ) {
      throw new TypeError('Invalid debug report options')
    }
    return host.tabs().debugReport(value as BrowserDebugReportOptions)
  })
  ipcMain.handle('browser:set-diagnostic-log-preservation', (event, tabId: unknown, preserve: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof preserve !== 'boolean') throw new TypeError('Invalid diagnostic log preservation state')
    host.tabs().setDiagnosticLogPreservation(tabId, preserve)
    return host.tabs().getState()
  })
  ipcMain.handle('browser:repro-recording', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid repro recording options')
    const { action, tabId } = value as Record<string, unknown>
    if (
      !['start', 'get', 'stop', 'clear'].includes(String(action))
      || (tabId !== undefined && typeof tabId !== 'string')
    ) throw new TypeError('Invalid repro recording options')
    return host.tabs().reproRecording(action as BrowserReproAction, tabId as string | undefined)
  })
  ipcMain.handle('browser:dom-changes', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid DOM changes options')
    const { action, tabId } = value as Record<string, unknown>
    if (
      !['start', 'get', 'stop', 'clear'].includes(String(action))
      || (tabId !== undefined && typeof tabId !== 'string')
    ) throw new TypeError('Invalid DOM changes options')
    return host.tabs().domChanges(action as BrowserDomChangesAction, tabId as string | undefined)
  })
  ipcMain.handle('browser:visual-compare', async (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid visual comparison options')
    const { action, tabId, threshold, settleMs } = value as Record<string, unknown>
    if (
      !['get', 'set-baseline', 'compare', 'clear'].includes(String(action))
      || (tabId !== undefined && typeof tabId !== 'string')
      || (threshold !== undefined && typeof threshold !== 'number')
      || (settleMs !== undefined && typeof settleMs !== 'number')
    ) throw new TypeError('Invalid visual comparison options')
    const result = await host.tabs().visualCompare(value as BrowserVisualCompareOptions)
    return {
      ...result.report,
      ...(result.diffPng ? { diffPngDataUrl: host.pngDataUrl(result.diffPng) } : {})
    }
  })
  ipcMain.handle('browser:copy-visual-diff', async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid visual comparison tab')
    const size = await host.copyPng(host.tabs().visualDiff(tabId as string | undefined))
    return { copied: true, width: size.width, height: size.height }
  })
  ipcMain.handle('browser:inspector-issues', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid inspector issue options')
    const { tabId, clear } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (clear !== undefined && typeof clear !== 'boolean')) {
      throw new TypeError('Invalid inspector issue options')
    }
    return host.tabs().inspectorIssues(tabId as string | undefined, clear === true)
  })
}
