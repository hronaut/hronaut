import { validateHeaderValue } from 'node:http'
import type { BrowserWindowConstructorOptions, LoadURLOptions, PostBody, Referrer, WebContents } from 'electron'
import type { OpenedTabCreation } from '../click-opened-tabs.js'
import { isHronautHomeUrl } from '../url.js'
import type { WindowOpenHandlerAccess, WindowOpenHandlerTab } from './window-open-handler-access.js'

/**
 * The load options that carry a page's requested referrer and form post into
 * the tab opened for its new window. It throws when the post's content type
 * is not a valid header value.
 */
function interceptedWindowLoadOptions(postBody: PostBody | undefined, referrer: Referrer): LoadURLOptions | undefined {
  const options: LoadURLOptions = {}
  if (referrer.url) options.httpReferrer = referrer
  if (postBody) {
    const contentType = postBody.boundary
      ? `${postBody.contentType}; boundary=${postBody.boundary}`
      : postBody.contentType
    validateHeaderValue('Content-Type', contentType)
    options.postData = postBody.data
    options.extraHeaders = `Content-Type: ${contentType}`
  }
  return Object.keys(options).length ? options : undefined
}

/**
 * Opens the page's new windows as tabs in its workspace, never as windows:
 * Home and addresses the workspace's navigation policy refuses are blocked,
 * and observations of tabs opened during an agent's click learn the outcome.
 * A workspace tab's new tab adopts the page Chromium created for the window,
 * so the opener gets its window and the new page its window.opener, as a
 * sign-in popup needs, and Chromium sends the requested referrer and form
 * post itself. That tab gets the page script, sandbox and isolation of every
 * tab, whatever window.open()'s features ask, outlives its opener, and
 * remembers the tab that opened it while the two pages can reach each
 * other. A tab outside a workspace loads the address in a new tab with the
 * referrer and form post carried over. A workspace tab's new tab goes beside
 * it, as in Chrome. A tab opened by an agent's input is not shown: Follow
 * agents shows it through the agent's calls on it, so it waits as for any
 * call, such as while a page fills the window.
 */
export function attachWindowOpenHandler<Tab extends WindowOpenHandlerTab>(access: WindowOpenHandlerAccess<Tab>, tab: Tab, webContents: WebContents): void {
  webContents.setWindowOpenHandler(({ url, disposition, postBody, referrer }) => {
    const observations = [...(access.openedTabObservations().get(tab) ?? [])]
    const blocked = (): { action: 'deny' } => {
      for (const observation of observations) observation.blockedRequest()
      return { action: 'deny' }
    }
    if (tab.mcpGroupId && isHronautHomeUrl(url)) return blocked()
    if (tab.mcpGroupId
      && !access.workspaceNavigationAllowed(tab.mcpGroupId, url, 'popup')) return blocked()
    const active = disposition !== 'background-tab'
    // Decided now: Chromium creates the page for the window later, when the agent's input may have ended.
    const selectVisible = !access.agentInputWebContents().has(webContents.id)
    const failed = (creations: OpenedTabCreation[], error: unknown): void => {
      for (const creation of creations) creation.failed()
      console.error(`[browser] Could not open requested page ${url}:`, error)
      access.options().onActionFailed?.('open page in new tab', error)
    }

    if (!tab.mcpGroupId) {
      let loadOptions: LoadURLOptions | undefined
      try {
        loadOptions = interceptedWindowLoadOptions(postBody, referrer)
      } catch (error) {
        console.error(`[browser] Could not preserve the requested page navigation to ${url}:`, error)
        access.options().onActionFailed?.('open page in new tab', error)
        for (const observation of observations) observation.failedRequest()
        return { action: 'deny' }
      }
      const creations = observations.map(observation => observation.creationStarted())
      void access.createTab({
        url,
        active,
        selectVisible,
        loadOptions,
        onCreated: (created) => { for (const creation of creations) creation.created(created.id) }
      }).catch((error) => failed(creations, error))
      return { action: 'deny' }
    }

    // A tab going to sleep still runs its page until the sleeping page replaces it, and a window opened then would
    // link the two pages while the tab sleeps.
    if (tab.sleeping) return blocked()
    const creations = observations.map(observation => observation.creationStarted())
    // Checked before Chromium creates the window, so window.open() returns no window, as for a blocked popup.
    try {
      access.assertCanOpenTab(tab.mcpGroupId)
    } catch (error) {
      failed(creations, error)
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      // The new tab stays open when its opener closes, as every tab does.
      outlivesOpener: true,
      // These apply after window.open()'s features, which could otherwise turn off the page's JavaScript.
      overrideBrowserWindowOptions: {
        webPreferences: {
          ...access.pageWebPreferences(),
          javascript: true,
          webviewTag: false,
          nodeIntegrationInSubFrames: false,
          nodeIntegrationInWorker: false
        }
      },
      createWindow: (options) => {
        // Electron 44 creates the page for every window a page opens and passes it with the options, which its
        // typings leave out; it requires this page back.
        const guest = (options as BrowserWindowConstructorOptions & { webContents: WebContents }).webContents
        let adopted = false
        void access.createTab({
          url,
          active,
          selectVisible,
          mcpGroupId: tab.mcpGroupId,
          openedFrom: { tabId: tab.id, background: !active, window: disposition === 'new-window' },
          adopt: {
            webContents: guest,
            webPreferences: options.webPreferences,
            // A link opened without an opener, such as target="_blank", has no way back to this page.
            ...(guest.opener ? { openerTabId: tab.id } : {})
          },
          onCreated: (created) => {
            adopted = true
            for (const creation of creations) creation.created(created.id)
          }
        }).catch((error) => {
          // No tab shows the page, so nothing else would ever close it.
          if (!adopted && !guest.isDestroyed()) guest.close()
          failed(creations, error)
        })
        return guest
      }
    }
  })
}
