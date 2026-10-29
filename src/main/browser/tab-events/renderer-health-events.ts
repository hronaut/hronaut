import type { WebContents } from 'electron'
import { translate, type MessageKey } from '../../../shared/i18n.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type { BrowserPageProblem } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { appendConsoleMessage } from '../console-messages/console-messages.js'
import { setEmulationViewSize } from '../emulation/emulation-view-size.js'
import { cancelNativeSelectionSessions } from '../native-selections/native-selections.js'
import { markNetworkConditionsUnknown } from '../network-conditions/network-conditions.js'
import { invalidateTabOverviewPreview } from '../tab-overview-previews/tab-overview-previews.js'
import { publishChange } from '../browser-state/browser-state.js'

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
export function attachRendererHealthEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.on('render-process-gone', (_event, details) => {
    // Ended from the Task manager, the page was terminated as the person asked rather than crashed, as Chrome says.
    const reason = browser.endedByPerson.take(webContents) ? 'killed' : details.reason
    if (tab.networkConditionApplication === 'pending') markNetworkConditionsUnknown(tab)
    tab.emulationContextGeneration++
    tab.emulationRevision++
    tab.emulationApplication = 'unknown'
    tab.nativeInputEnvironmentGeneration++
    publishChange(browser, false)
    setEmulationViewSize(browser, tab, undefined)
    invalidateTabOverviewPreview(browser, tab)
    browser.tabOverviewPreviewCaptures.cancelPending(tab.id)
    browser.tabOverviewPreviewableTabs.delete(tab.id)
    if (browser.rendererRecovery.expectsExit(webContents)) return
    browser.networkWaitController.reject(tab.id, 'The tab renderer became unavailable while waiting for network activity.')
    cancelNativeSelectionSessions(browser, tab)
    if (tab.pageLifecycleState !== 'active') {
      tab.pageLifecycleState = 'unknown'
      tab.pageLifecycleUnknownRequest ??= 'frozen'
    }
    tab.loading = false
    tab.title = browser.text('native.dialog.pageUnavailable')
    tab.pageProblem = rendererFailureProblem(browser.options.getLocale(), tab.url, reason, details.exitCode)
    appendConsoleMessage(tab, {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: `Renderer process exited: ${reason} (exit code ${details.exitCode})`,
      lineNumber: 0,
      sourceId: tab.url,
      kind: 'lifecycle'
    }, 'lifecycle')
    publishChange(browser)
  })
  webContents.on('unresponsive', () => {
    tab.pageProblem = {
      kind: 'unresponsive',
      title: browser.text('native.dialog.unresponsiveTitle'),
      message: browser.text('native.dialog.unresponsiveMessage'),
      url: tab.url
    }
    publishChange(browser, false)
  })
  webContents.on('responsive', () => {
    if (tab.pageProblem?.kind !== 'unresponsive') return
    tab.pageProblem = undefined
    publishChange(browser, false)
  })
}
