import { validateHeaderValue } from 'node:http'
import type { BrowserWindowConstructorOptions, LoadURLOptions, PostBody, Referrer, WebContents, WebPreferences } from 'electron'
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
 * A workspace tab adopts the page Chromium created for the new window, so
 * the opener gets its window and the new page its window.opener, as a
 * sign-in popup needs, and Chromium sends the requested referrer and form
 * post itself; the new tab gets the same page script and sandbox as every
 * tab and outlives its opener. A tab outside a workspace loads the address
 * in a new tab with the referrer and form post carried over. A tab opened by
 * an agent's input is not shown: Follow agents shows it through the agent's
 * calls on it, so it waits as for any call, such as while a page fills the
 * window.
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
    const open = (adopt?: { webContents: WebContents; webPreferences?: WebPreferences }): WebContents | undefined => {
      let opened: WebContents | undefined
      void access.createTab({
        url,
        active: disposition !== 'background-tab',
        selectVisible: !access.agentInputWebContents().has(webContents.id),
        mcpGroupId: tab.mcpGroupId,
        ...(adopt ? { adopt } : { loadOptions }),
        onCreated: (created) => {
          opened = created.webContents
          for (const creation of creations) creation.created(created.id)
        }
      })
        .catch((error) => {
          // No tab shows the page Chromium created for the window, so nothing else would ever close it.
          if (adopt && opened !== adopt.webContents && !adopt.webContents.isDestroyed()) adopt.webContents.close()
          for (const creation of creations) creation.failed()
          console.error(`[browser] Could not open requested page ${url}:`, error)
          access.options().onActionFailed?.('open page in new tab', error)
        })
      return opened
    }
    if (!tab.mcpGroupId) {
      open()
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      // The new tab stays open when its opener closes, as every tab does.
      outlivesOpener: true,
      overrideBrowserWindowOptions: { webPreferences: access.pageWebPreferences() },
      createWindow: (options) => {
        // Electron passes the page it created along with the options, which its typings leave out.
        const guest = (options as BrowserWindowConstructorOptions & { webContents?: WebContents }).webContents
        // Electron creates the page for every window a page opens; without one, it leaves loading the address to us
        // and ignores what this returns.
        if (!guest) return open()!
        open({ webContents: guest, webPreferences: options.webPreferences })
        return guest
      }
    }
  })
}
