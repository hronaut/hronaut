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
    const requestTab = (details: { webContentsId?: number }): Tab | undefined => {
      const tabId = details.webContentsId ? access.tabIdForWebContents(details.webContentsId) : undefined
      return tabId ? access.findTab(tabId) : undefined
    }
    // The record of the request's latest address. A redirect starts a record of its own, as the debugger keeps one
    // for each address a request goes to: web:<id> first, then web:<id>-1, web:<id>-2.
    const latestRecord = (tab: Tab, id: number) => {
      const first = `web:${id}`
      for (let index = tab.networkRequests.length - 1; index >= 0; index -= 1) {
        const candidate = tab.networkRequests[index]!
        if (candidate.id === first || candidate.id.startsWith(`${first}-`)) return candidate
      }
      return undefined
    }
    // Requests are only watched, never held: a listener with a callback, such as onBeforeRequest, makes every request
    // of every tab wait for Hronaut's main process, which is busiest while many pages load at once. Chromium reports
    // each request as it is sent, again for each redirect, before it reports how it ended.
    browserSession.webRequest.onSendHeaders((details) => {
      // A tab whose debugger records its requests records them in more detail.
      const tab = requestTab(details)
      if (!tab || tab.networkDebuggerEnabled) return
      const latest = latestRecord(tab, details.id)
      if (latest && latest.completedAt === undefined) return
      const first = `web:${details.id}`
      const id = !latest ? first : `${first}-${latest.id === first ? 1 : Number(latest.id.slice(first.length + 1)) + 1}`
      tab.networkRequests.push({
        id,
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
    })
    browserSession.webRequest.onBeforeRedirect((details) => {
      const tab = requestTab(details)
      const request = tab && latestRecord(tab, details.id)
      if (!tab || !request || request.completedAt !== undefined) return
      request.completedAt = new Date().toISOString()
      request.status = details.statusCode
      request.fromCache = details.fromCache
      request.responseSource = details.fromCache ? 'other-cache' : 'network'
      access.networkWaitController().notify(tab)
    })
    browserSession.webRequest.onCompleted((details) => {
      const tab = requestTab(details)
      // What a page loads counts for whether it is private; its own document counts once it shows.
      if (tab && details.resourceType !== 'mainFrame') access.contentLoaded(tab, details.url)
      const request = tab && latestRecord(tab, details.id)
      if (!tab || !request || request.completedAt !== undefined) return
      request.completedAt = new Date().toISOString()
      request.status = details.statusCode
      request.fromCache = details.fromCache
      request.responseSource = details.fromCache ? 'other-cache' : 'network'
      access.networkWaitController().notify(tab)
    })
    browserSession.webRequest.onErrorOccurred((details) => {
      // A request whose record was cleared, as at a navigation, stays cleared.
      const tab = requestTab(details)
      const request = tab && latestRecord(tab, details.id)
      if (!tab || !request || request.completedAt !== undefined) return
      request.completedAt = new Date().toISOString()
      request.error = details.error
      access.networkWaitController().notify(tab)
    })
  }

  access.downloadController().attachSession(browserSession)
}
