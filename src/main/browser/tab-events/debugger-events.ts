import type { WebContents } from 'electron'
import {
  normalizeConsoleLogEntry,
  normalizeRuntimeConsoleCall,
  normalizeRuntimeConsolePresentation,
  normalizeRuntimeException,
  type CdpLogEntry,
  type CdpRuntimeConsoleCall,
  type CdpRuntimeExceptionDetails
} from '../../../shared/console-exceptions.js'
import type { BrowserJavaScriptDialog } from '../../../shared/types.js'
import { recordNetworkDebuggerMessage, retireNetworkPriorityObservations } from '../network-recording.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { appendConsoleMessage, retainRuntimeConsoleMessage } from '../console-messages/console-messages.js'
import { setEmulationViewSize } from '../emulation/emulation-view-size.js'
import { addInspectorIssue } from '../inspector-issues/inspector-issues.js'
import { queueNetworkRouteRequest } from '../network-conditions/network-conditions.js'
import { dismissWebsiteDialogForTrustedChrome, ensureDialogMonitoring } from '../website-dialogs/website-dialogs.js'
import { publishChange } from '../browser-state/browser-state.js'

/**
 * Follows the page's debugger. Its messages feed paused requests to the
 * request rules, network activity to the recording and network waits, the
 * main frame, console messages and revoked exceptions, the main world
 * execution contexts, website dialogs (dismissed while trusted chrome covers
 * the page), inspector issues, and style sheets and debugger pauses for
 * profiling. Detachment
 * marks emulation and request conditions unknown, forgets the dialog, main
 * frame and contexts, marks a frozen lifecycle unknown, and monitors dialogs
 * again on the next turn unless the tab closed or Developer Tools took the
 * debugger.
 */
export function attachDebuggerEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Fetch.requestPaused') {
      queueNetworkRouteRequest(browser, tab, params)
    } else if (method.startsWith('Network.')) {
      recordNetworkDebuggerMessage(tab, method, params)
      browser.networkWaitController.notify(tab)
    } else if (method === 'Page.frameNavigated') {
      const frame = (params as { frame?: { id?: string; parentId?: string } }).frame
      if (frame?.id && !frame.parentId) tab.mainFrameId = frame.id
    } else if (method === 'Log.entryAdded') {
      const message = normalizeConsoleLogEntry((params as { entry?: CdpLogEntry }).entry)
      if (message) appendConsoleMessage(tab, message, 'log')
    } else if (method === 'Runtime.exceptionThrown') {
      const message = normalizeRuntimeException(params as {
        timestamp?: number
        exceptionDetails?: CdpRuntimeExceptionDetails
      })
      if (message) appendConsoleMessage(tab, message, 'runtime')
    } else if (method === 'Runtime.consoleAPICalled') {
      const call = params as CdpRuntimeConsoleCall
      const formatted = normalizeRuntimeConsolePresentation(call)
      const message = formatted?.match ?? normalizeRuntimeConsoleCall(call)
      if (message) retainRuntimeConsoleMessage(tab, { ...message,
        ...(formatted ? { presentation: formatted.presentation } : {})
      })
    } else if (method === 'Runtime.exceptionRevoked') {
      const exceptionId = (params as { exceptionId?: number }).exceptionId
      if (Number.isFinite(exceptionId)) {
        const message = [...tab.consoleMessages].reverse().find((candidate) => candidate.exceptionId === exceptionId)
        if (message) message.handled = true
      }
    } else if (method === 'Runtime.executionContextCreated') {
      const details = params as {
        context?: { id?: number; uniqueId?: string; auxData?: { frameId?: string; isDefault?: boolean } }
      }
      const context = details.context
      const frameId = context?.auxData?.frameId
      if (context?.auxData?.isDefault && frameId && context.id !== undefined) {
        const contexts = browser.defaultExecutionContexts.get(webContents.id) ?? new Map<string, { id: number; uniqueId?: string }>()
        contexts.set(frameId, { id: context.id, uniqueId: context.uniqueId })
        browser.defaultExecutionContexts.set(webContents.id, contexts)
      }
    } else if (method === 'Runtime.executionContextDestroyed') {
      const contextId = (params as { executionContextId?: number }).executionContextId
      if (contextId !== undefined) {
        const contexts = browser.defaultExecutionContexts.get(webContents.id)
        for (const [frameId, id] of contexts ?? []) {
          if (id.id === contextId) contexts?.delete(frameId)
        }
      }
    } else if (method === 'Runtime.executionContextsCleared') {
      browser.defaultExecutionContexts.delete(webContents.id)
    } else if (method === 'Page.javascriptDialogOpening') {
      const details = params as {
        type?: string
        message?: string
        url?: string
        defaultPrompt?: string
      }
      if (!['alert', 'confirm', 'prompt'].includes(details.type ?? '')) return
      if (browser.browserContentOccluded) {
        void dismissWebsiteDialogForTrustedChrome(browser, tab)
        return
      }
      tab.dialog = {
        type: details.type as BrowserJavaScriptDialog['type'],
        message: String(details.message ?? '').slice(0, 4096),
        url: String(details.url ?? tab.url).slice(0, 8192),
        ...(details.defaultPrompt !== undefined ? { defaultPrompt: String(details.defaultPrompt).slice(0, 4096) } : {})
      }
      publishChange(browser, false)
    } else if (method === 'Page.javascriptDialogClosed') {
      tab.dialog = undefined
      publishChange(browser, false)
    } else if (method === 'Audits.issueAdded') {
      addInspectorIssue(browser, tab, (params as { issue?: unknown }).issue)
    } else if (method === 'CSS.styleSheetAdded' || method === 'CSS.styleSheetRemoved' || method === 'Debugger.paused') {
      browser.profiling.handleDebuggerMessage(tab, method, params)
    }
  })
  webContents.debugger.on('detach', () => {
    tab.networkConditionEpoch++
    tab.networkDebuggerEpoch++
    tab.emulationRevision++
    tab.emulationContextGeneration++
    tab.emulationApplication = 'unknown'
    tab.nativeInputEnvironmentGeneration++
    tab.networkConditionApplication = 'unknown'
    retireNetworkPriorityObservations(tab)
    tab.dialog = undefined
    tab.mainFrameId = undefined
    tab.networkDebuggerEnabled = false
    if (tab.pageLifecycleState === 'frozen') {
      tab.pageLifecycleState = 'unknown'
      tab.pageLifecycleUnknownRequest = 'frozen'
    }
    browser.profiling.handleDebuggerDetached(tab)
    browser.cssStatePreview.debuggerDetached(tab)
    browser.defaultExecutionContexts.delete(webContents.id)
    publishChange(browser, false)
    setEmulationViewSize(browser, tab, undefined)
    if (
      !browser.destroyed
      && browser.tabs.has(tab.id)
      && !browser.devToolsOpening.has(webContents.id)
      && !webContents.isDevToolsOpened()
    ) {
      setImmediate(() => { void ensureDialogMonitoring(browser, tab) })
    }
  })
}
