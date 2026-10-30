import { videoOptionsSchema } from '../shared/video.js'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { Browser } from './browser/browser.js'
import { LocalizedError } from './localized-error.js'
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
import { videoPreview, videoRecording } from './browser/video-recording/video-recording.js'
import { visualDiff, visualCompare } from './browser/visual-compare/visual-compare.js'
import { debugReport, setDiagnosticLogPreservation } from './browser/debug-report/debug-report.js'
import { inspectorIssues } from './browser/inspector-issues/inspector-issues.js'
import { accessibilityAudit } from './browser/page-audits/accessibility-audit.js'
import { designOverview } from './browser/page-audits/design-overview.js'
import { performanceReport } from './browser/page-audits/performance-report.js'
import { qualityAudit } from './browser/page-audits/quality-audit.js'
import { securityReport } from './browser/page-audits/security-report.js'
import { browserState } from './browser/browser-state/browser-state.js'
import { domChanges } from './browser/dom-recorder/browser-dom-recorder.js'
import { reproRecording } from './browser/repro-recorder/browser-repro-recorder.js'
import { codeCoverage } from './browser/profiling/browser-profiling.js'

interface DiagnosticsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  tabs(): Browser
  pngDataUrl(data: Buffer): string
  copyPng(data: Buffer): Promise<{ width: number; height: number }>
  pickVideoAudio?(): Promise<string | undefined>
}

function isAllowedString(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === 'string' && allowed.includes(value)
}

/** Keep services lazy: registration precedes browser-window initialization. */
export function registerDiagnosticsIpc(ipcMain: Pick<IpcMain, 'handle'>, host: DiagnosticsIpcHost): void {
  ipcMain.handle('browser:accessibility-audit', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid accessibility audit options')
    const { tabId, action, selector, standard, maxViolations, maxNodesPerViolation } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && !isAllowedString(action, ['measure', 'set-baseline', 'clear-baseline']))
      || (selector !== undefined && typeof selector !== 'string')
      || (standard !== undefined && !isAllowedString(standard, ['wcag-aa', 'wcag-aaa', 'best-practice', 'all']))
      || (maxViolations !== undefined && typeof maxViolations !== 'number')
      || (maxNodesPerViolation !== undefined && typeof maxNodesPerViolation !== 'number')
    ) {
      throw new TypeError('Invalid accessibility audit options')
    }
    return accessibilityAudit(host.tabs(), value as BrowserAccessibilityAuditOptions)
  })
  ipcMain.handle('browser:quality-audit', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid quality audit tab')
    return qualityAudit(host.tabs(), tabId)
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
    return performanceReport(host.tabs(), value as BrowserPerformanceOptions)
  })
  ipcMain.handle('browser:design-overview', (event, tabId: unknown): Promise<BrowserDesignOverviewReport> => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid design overview tab')
    return designOverview(host.tabs(), tabId)
  })
  ipcMain.handle('browser:page-metadata', (event, tabId: unknown): Promise<BrowserPageMetadataReport> => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid page metadata tab')
    return host.tabs().metadata.inspect(tabId)
  })
  ipcMain.handle('browser:security', (event, tabId: unknown): BrowserSecurityReport => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid security report tab')
    return securityReport(host.tabs(), tabId)
  })
  ipcMain.handle('browser:code-coverage', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid code coverage options')
    const { tabId, action, mode, reload } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && !isAllowedString(action, ['get', 'start', 'stop', 'clear']))
      || (mode !== undefined && !isAllowedString(mode, ['function', 'block']))
      || (reload !== undefined && typeof reload !== 'boolean')
    ) {
      throw new TypeError('Invalid code coverage options')
    }
    return codeCoverage(host.tabs(), value as BrowserCodeCoverageOptions)
  })
  ipcMain.handle('browser:cpu-profile', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid JavaScript CPU profile options')
    const { tabId, action } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && !isAllowedString(action, ['get', 'start', 'stop', 'clear']))
    ) {
      throw new TypeError('Invalid JavaScript CPU profile options')
    }
    return host.tabs().profiling.cpuProfile(value as BrowserCpuProfileOptions)
  })
  ipcMain.handle('browser:memory', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid memory options')
    const { tabId, action, collectGarbage } = value as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== undefined && !isAllowedString(action, [
        'measure',
        'set-baseline',
        'clear-baseline',
        'start-allocation-sampling',
        'stop-allocation-sampling',
        'clear-allocation-sampling'
      ]))
      || (collectGarbage !== undefined && typeof collectGarbage !== 'boolean')
    ) {
      throw new TypeError('Invalid memory options')
    }
    return host.tabs().profiling.memoryReport(value as BrowserMemoryOptions)
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
    return debugReport(host.tabs(), value as BrowserDebugReportOptions)
  })
  ipcMain.handle('browser:set-diagnostic-log-preservation', (event, tabId: unknown, preserve: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof preserve !== 'boolean') throw new TypeError('Invalid diagnostic log preservation state')
    setDiagnosticLogPreservation(host.tabs(), tabId, preserve)
    return browserState(host.tabs())
  })
  ipcMain.handle('browser:video', (event, value: unknown) => {
    host.assertTrustedSender(event)
    const options = videoOptionsSchema.parse(value)
    return videoRecording(host.tabs(), options)
  })
  ipcMain.handle('browser:video-preview', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid video tab')
    return videoPreview(host.tabs(), tabId)
  })
  ipcMain.handle('browser:video-import-audio', async (event, tabId: unknown, provenance: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || !tabId || typeof provenance !== 'string' || !provenance.trim() || provenance.length > 240) throw new TypeError('Audio import requires a tab and source/usage rights')
    const tabs = host.tabs()
    const before = await videoRecording(tabs, { tabId, action: 'get' })
    if (!before.recordingId || before.status !== 'stopped') throw new LocalizedError('video.errors.stopBeforeImport')
    if (!host.pickVideoAudio) throw new Error('Audio import is unavailable')
    const path = await host.pickVideoAudio()
    host.assertTrustedSender(event)
    const current = await videoRecording(tabs, { tabId, action: 'get' })
    if (current.recordingId !== before.recordingId || current.status !== 'stopped') throw new LocalizedError('video.errors.recordingChanged')
    if (!path) return current
    return videoRecording(tabs, { tabId, action: 'import-audio', audioPath: path, audioProvenance: provenance.trim() }, () => host.assertTrustedSender(event))
  })
  ipcMain.handle('browser:repro-recording', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid repro recording options')
    const { action, tabId, checkpoint } = value as Record<string, unknown>
    if (
      !isAllowedString(action, ['start', 'get', 'stop', 'clear', 'checkpoint'])
      || (tabId !== undefined && typeof tabId !== 'string')
    ) throw new TypeError('Invalid repro recording options')
    return action === 'checkpoint'
      ? reproRecording(host.tabs(), action, tabId as string | undefined, checkpoint)
      : reproRecording(host.tabs(), action as BrowserReproAction, tabId as string | undefined)
  })
  ipcMain.handle('browser:dom-changes', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid DOM changes options')
    const { action, tabId } = value as Record<string, unknown>
    if (
      !isAllowedString(action, ['start', 'get', 'stop', 'clear'])
      || (tabId !== undefined && typeof tabId !== 'string')
    ) throw new TypeError('Invalid DOM changes options')
    return domChanges(host.tabs(), action as BrowserDomChangesAction, tabId as string | undefined)
  })
  ipcMain.handle('browser:visual-compare', async (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid visual comparison options')
    const { action, tabId, threshold, settleMs } = value as Record<string, unknown>
    if (
      !isAllowedString(action, ['get', 'set-baseline', 'compare', 'clear'])
      || (tabId !== undefined && typeof tabId !== 'string')
      || (threshold !== undefined && typeof threshold !== 'number')
      || (settleMs !== undefined && typeof settleMs !== 'number')
    ) throw new TypeError('Invalid visual comparison options')
    const result = await visualCompare(host.tabs(), value as BrowserVisualCompareOptions)
    return {
      ...result.report,
      ...(result.diffPng ? { diffPngDataUrl: host.pngDataUrl(result.diffPng) } : {})
    }
  })
  ipcMain.handle('browser:copy-visual-diff', async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid visual comparison tab')
    const size = await host.copyPng(visualDiff(host.tabs(), tabId as string | undefined))
    return { copied: true, width: size.width, height: size.height }
  })
  ipcMain.handle('browser:inspector-issues', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid inspector issue options')
    const { tabId, clear } = value as Record<string, unknown>
    if ((tabId !== undefined && typeof tabId !== 'string') || (clear !== undefined && typeof clear !== 'boolean')) {
      throw new TypeError('Invalid inspector issue options')
    }
    return inspectorIssues(host.tabs(), tabId as string | undefined, clear === true)
  })
}
