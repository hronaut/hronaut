import { validateHeaderValue } from 'node:http'
import type { LoadURLOptions, PostBody, Referrer, WebContents } from 'electron'
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
 * a requested referrer and form post are carried over, and observations of
 * tabs opened during an agent's click learn the outcome.
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
    void access.createTab({
      url,
      active: disposition !== 'background-tab',
      selectVisible: !access.agentInputWebContents().has(webContents.id) || access.followAgentActivity(),
      mcpGroupId: tab.mcpGroupId,
      loadOptions,
      onCreated: (created) => { for (const creation of creations) creation.created(created.id) }
    })
      .catch((error) => {
        for (const creation of creations) creation.failed()
        console.error(`[browser] Could not open requested page ${url}:`, error)
        access.options().onActionFailed?.('open page in new tab', error)
      })
    return { action: 'deny' }
  })
}
