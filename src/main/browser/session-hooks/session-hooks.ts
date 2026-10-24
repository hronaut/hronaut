import type { Session } from 'electron'
import { trimNetworkRequests } from '../network-recording.js'
import { restoringSessionCookies } from '../session-cookies/saved-session-cookies.js'
import type { SessionHooksAccess, SessionHooksTab } from './session-hooks-access.js'

/**
 * Hooks a browser session once: its cookie changes advance the generation of
 * every tab on that session, its requests are recorded for tabs whose debugger
 * does not record them, and its downloads are tracked.
 */
export function installSessionHooks<Tab extends SessionHooksTab>(access: SessionHooksAccess<Tab>, browserSession: Session): void {
  if (!access.browserSessionAuthorityHooks().has(browserSession)) {
    const onCookieChanged = (): void => {
      if (access.isDestroyed()) return
      let changed = false
      for (const tab of access.tabs()) {
        if (tab.webContents.isDestroyed() || tab.webContents.session !== browserSession) continue
        tab.browserSessionGeneration = tab.browserSessionGeneration === Number.MAX_SAFE_INTEGER
          ? 0
          : tab.browserSessionGeneration + 1
        changed = true
      }
      // Authority generations still advance immediately, but a bulk import, or saved session cookies set again,
      // publishes its final state once instead of rerendering per cookie.
      if (changed && !access.browserCookieImportSessions().has(browserSession) && !restoringSessionCookies(browserSession)) access.changed(false)
    }
    browserSession.cookies.on('changed', onCookieChanged)
    access.browserSessionAuthorityHooks().set(browserSession, onCookieChanged)
  }
  if (!access.networkHookSessions().has(browserSession)) {
    access.networkHookSessions().add(browserSession)
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const tabId = details.webContentsId ? access.tabIdForWebContents(details.webContentsId) : undefined
      const tab = tabId ? access.findTab(tabId) : undefined
      if (tab && !tab.networkDebuggerEnabled) {
        tab.networkRequests.push({
          id: `web:${details.id}`,
          captureSequence: ++tab.networkCaptureSequence,
          observationGeneration: tab.observationGeneration,
          url: details.url,
          method: details.method,
          resourceType: details.resourceType,
          startedAt: new Date(details.timestamp).toISOString(),
          detailsAvailable: false
        })
        trimNetworkRequests(tab)
        access.networkWaitController().notify(tab)
      }
      callback({})
    })
    browserSession.webRequest.onCompleted((details) => {
      const tabId = details.webContentsId ? access.tabIdForWebContents(details.webContentsId) : undefined
      const request = tabId ? access.findTab(tabId)?.networkRequests.find((candidate) => candidate.id === `web:${details.id}`) : undefined
      if (!request) return
      request.completedAt = new Date().toISOString()
      request.status = details.statusCode
      request.fromCache = details.fromCache
      request.responseSource = details.fromCache ? 'other-cache' : 'network'
      const tab = tabId ? access.findTab(tabId) : undefined
      if (tab) access.networkWaitController().notify(tab)
    })
    browserSession.webRequest.onErrorOccurred((details) => {
      const tabId = details.webContentsId ? access.tabIdForWebContents(details.webContentsId) : undefined
      const request = tabId ? access.findTab(tabId)?.networkRequests.find((candidate) => candidate.id === `web:${details.id}`) : undefined
      if (!request) return
      request.completedAt = new Date().toISOString()
      request.error = details.error
      const tab = tabId ? access.findTab(tabId) : undefined
      if (tab) access.networkWaitController().notify(tab)
    })
  }

  access.downloadController().attachSession(browserSession)
}
