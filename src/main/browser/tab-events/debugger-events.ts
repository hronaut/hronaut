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
import type { DebuggerEventsAccess, DebuggerEventsTab } from './debugger-events-access.js'

/**
 * Follows the page's debugger. Its messages feed paused requests to the
 * request rules, network activity to the recording and network waits, the
 * main frame, console messages and revoked exceptions, the main world
 * execution contexts, website dialogs (dismissed while trusted chrome covers
 * the page), inspector issues and style sheets for profiling. Detachment
 * marks emulation and request conditions unknown, forgets the dialog, main
 * frame and contexts, marks a frozen lifecycle unknown, and monitors dialogs
 * again on the next turn unless the tab closed or Developer Tools took the
 * debugger.
 */
export function attachDebuggerEvents<Tab extends DebuggerEventsTab>(access: DebuggerEventsAccess<Tab>, tab: Tab, webContents: WebContents): void {
  webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Fetch.requestPaused') {
      access.queueNetworkRouteRequest(tab, params)
    } else if (method.startsWith('Network.')) {
      recordNetworkDebuggerMessage(tab, method, params)
      access.networkWaitController().notify(tab)
    } else if (method === 'Page.frameNavigated') {
      const frame = (params as { frame?: { id?: string; parentId?: string } }).frame
      if (frame?.id && !frame.parentId) tab.mainFrameId = frame.id
    } else if (method === 'Log.entryAdded') {
      const message = normalizeConsoleLogEntry((params as { entry?: CdpLogEntry }).entry)
      if (message) access.appendConsoleMessage(tab, message, 'log')
    } else if (method === 'Runtime.exceptionThrown') {
      const message = normalizeRuntimeException(params as {
        timestamp?: number
        exceptionDetails?: CdpRuntimeExceptionDetails
      })
      if (message) access.appendConsoleMessage(tab, message, 'runtime')
    } else if (method === 'Runtime.consoleAPICalled') {
      const call = params as CdpRuntimeConsoleCall
      const formatted = normalizeRuntimeConsolePresentation(call)
      const message = formatted?.match ?? normalizeRuntimeConsoleCall(call)
      if (message) access.retainRuntimeConsoleMessage(tab, { ...message,
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
        const contexts = access.defaultExecutionContexts().get(webContents.id) ?? new Map<string, { id: number; uniqueId?: string }>()
        contexts.set(frameId, { id: context.id, uniqueId: context.uniqueId })
        access.defaultExecutionContexts().set(webContents.id, contexts)
      }
    } else if (method === 'Runtime.executionContextDestroyed') {
      const contextId = (params as { executionContextId?: number }).executionContextId
      if (contextId !== undefined) {
        const contexts = access.defaultExecutionContexts().get(webContents.id)
        for (const [frameId, id] of contexts ?? []) {
          if (id.id === contextId) contexts?.delete(frameId)
        }
      }
    } else if (method === 'Runtime.executionContextsCleared') {
      access.defaultExecutionContexts().delete(webContents.id)
    } else if (method === 'Page.javascriptDialogOpening') {
      const details = params as {
        type?: string
        message?: string
        url?: string
        defaultPrompt?: string
      }
      if (!['alert', 'confirm', 'prompt'].includes(details.type ?? '')) return
      if (access.browserContentOccluded()) {
        void access.dismissWebsiteDialogForTrustedChrome(tab)
        return
      }
      tab.dialog = {
        type: details.type as BrowserJavaScriptDialog['type'],
        message: String(details.message ?? '').slice(0, 4096),
        url: String(details.url ?? tab.url).slice(0, 8192),
        ...(details.defaultPrompt !== undefined ? { defaultPrompt: String(details.defaultPrompt).slice(0, 4096) } : {})
      }
      access.changed(false)
    } else if (method === 'Page.javascriptDialogClosed') {
      tab.dialog = undefined
      access.changed(false)
    } else if (method === 'Audits.issueAdded') {
      access.addInspectorIssue(tab, (params as { issue?: unknown }).issue)
    } else if (method === 'CSS.styleSheetAdded' || method === 'CSS.styleSheetRemoved' || method === 'Debugger.paused') {
      access.profiling().handleDebuggerMessage(tab, method, params)
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
    access.profiling().handleDebuggerDetached(tab)
    access.cssStatePreview().debuggerDetached(tab)
    access.defaultExecutionContexts().delete(webContents.id)
    access.changed(false)
    access.setEmulationViewSize(tab, undefined)
    if (
      !access.isDestroyed()
      && access.hasTab(tab.id)
      && !access.devToolsOpening().has(webContents.id)
      && !webContents.isDevToolsOpened()
    ) {
      setImmediate(() => { void access.ensureDialogMonitoring(tab) })
    }
  })
}
