import type { WebContents } from 'electron'
import { translate, type MessageKey } from '../../../shared/i18n.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type { BrowserPageProblem } from '../../../shared/types.js'
import type { RendererHealthEventsAccess, RendererHealthEventsTab } from './renderer-health-events-access.js'

/** The message explaining each reason Electron gives for a renderer exit. */
const RENDERER_FAILURE_MESSAGES: Record<string, MessageKey> = {
  'abnormal-exit': 'native.pageProblem.abnormalExit',
  crashed: 'native.pageProblem.crashed',
  'integrity-failure': 'native.pageProblem.integrityFailure',
  killed: 'native.pageProblem.killed',
  'launch-failed': 'native.pageProblem.launchFailed',
  oom: 'native.pageProblem.outOfMemory'
}

/** The problem a tab shows after its renderer exits, localized, with the exit reason and code. */
function rendererFailureProblem(locale: SupportedLocale, url: string, reason: string, exitCode: number): BrowserPageProblem {
  return {
    kind: 'renderer-gone',
    title: translate(locale, 'native.pageProblem.rendererTitle'),
    message: translate(locale, RENDERER_FAILURE_MESSAGES[reason] ?? 'native.pageProblem.rendererDefault'),
    url,
    reason,
    exitCode
  }
}

/**
 * Follows the page's renderer exits and hangs. An exit advances the
 * emulation and native input generations, marks emulation and pending
 * request conditions unknown, stops sizing the view for emulation and drops
 * the tab's overview preview; unless renderer recovery caused it, it also
 * ends network waits and selection sessions, marks a held lifecycle unknown,
 * shows the problem and logs it. A hang shows a problem that responding
 * clears.
 */
export function attachRendererHealthEvents<Tab extends RendererHealthEventsTab>(access: RendererHealthEventsAccess<Tab>, tab: Tab, webContents: WebContents): void {
  webContents.on('render-process-gone', (_event, details) => {
    if (tab.networkConditionApplication === 'pending') access.markNetworkConditionsUnknown(tab)
    tab.emulationContextGeneration++
    tab.emulationRevision++
    tab.emulationApplication = 'unknown'
    tab.nativeInputEnvironmentGeneration++
    access.changed(false)
    access.setEmulationViewSize(tab, undefined)
    access.invalidateTabOverviewPreview(tab)
    access.tabOverviewPreviewCaptures().cancelPending(tab.id)
    access.tabOverviewPreviewableTabs().delete(tab.id)
    if (access.rendererRecovery().expectsExit(webContents)) return
    access.networkWaitController().reject(tab.id, 'The tab renderer became unavailable while waiting for network activity.')
    access.cancelNativeSelectionSessions(tab)
    if (tab.pageLifecycleState !== 'active') {
      tab.pageLifecycleState = 'unknown'
      tab.pageLifecycleUnknownRequest ??= 'frozen'
    }
    tab.loading = false
    tab.title = access.text('native.dialog.pageUnavailable')
    tab.pageProblem = rendererFailureProblem(access.options().getLocale(), tab.url, details.reason, details.exitCode)
    access.appendConsoleMessage(tab, {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: `Renderer process exited: ${details.reason} (exit code ${details.exitCode})`,
      lineNumber: 0,
      sourceId: tab.url,
      kind: 'lifecycle'
    }, 'lifecycle')
    access.changed()
  })
  webContents.on('unresponsive', () => {
    tab.pageProblem = {
      kind: 'unresponsive',
      title: access.text('native.dialog.unresponsiveTitle'),
      message: access.text('native.dialog.unresponsiveMessage'),
      url: tab.url
    }
    access.changed(false)
  })
  webContents.on('responsive', () => {
    if (tab.pageProblem?.kind !== 'unresponsive') return
    tab.pageProblem = undefined
    access.changed(false)
  })
}
