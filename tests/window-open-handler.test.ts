import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { OpenedTabObservation } from '../src/main/browser/click-opened-tabs.js'
import { attachWindowOpenHandler } from '../src/main/browser/tab-events/window-open-handler.js'
import type { WindowOpenHandlerAccess, WindowOpenHandlerTab } from '../src/main/browser/tab-events/window-open-handler-access.js'

// A website's sign-in popup got no window: Hronaut denied every new window and loaded its address in a new tab, so
// window.open() returned null and the new page had no window.opener to send the result back to.

interface Details { url: string; disposition: string; referrer: { url: string; policy: string }; postBody?: unknown }
interface Response {
  action: 'allow' | 'deny'
  outlivesOpener?: boolean
  overrideBrowserWindowOptions?: { webPreferences?: Record<string, unknown> }
  createWindow?: (options: { webContents: WebContents; webPreferences?: Record<string, unknown> }) => WebContents
}

const PAGE_PREFERENCES = { preload: '/app/preload/page.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true }

/** The page Chromium created for the window; window.open() gives it an opener, a target="_blank" link does not. */
function guestPage(options: { opener?: boolean } = {}): WebContents & { close: ReturnType<typeof vi.fn> } {
  return { isDestroyed: vi.fn(() => false), close: vi.fn(), opener: options.opener === false ? null : { url: 'https://app.example/' } } as unknown as WebContents & { close: ReturnType<typeof vi.fn> }
}

function fixture(options: { mcpGroupId?: string; allowed?: boolean; createTab?: WindowOpenHandlerAccess<WindowOpenHandlerTab>['createTab'] } = {}) {
  const agentInput = new Map<number, number>()
  const tab: WindowOpenHandlerTab = { id: 'opener', webContents: { id: 7 } as WebContents, ...('mcpGroupId' in options ? { mcpGroupId: options.mcpGroupId } : { mcpGroupId: 'client' }) }
  const observation = new OpenedTabObservation()
  const onActionFailed = vi.fn()
  const createTab = vi.fn(options.createTab ?? (async (tabOptions) => {
    const created = { id: 'popup', webContents: tabOptions.adopt?.webContents ?? ({ id: 8 } as WebContents) }
    tabOptions.onCreated?.(created)
    return created
  }))
  const access: WindowOpenHandlerAccess<WindowOpenHandlerTab> = {
    pageWebPreferences: () => PAGE_PREFERENCES,
    openedTabObservations: () => new Map([[tab, new Set([observation])]]),
    workspaceNavigationAllowed: () => options.allowed ?? true,
    options: () => ({ onActionFailed }),
    createTab,
    agentInputWebContents: () => agentInput
  }
  let handler!: (details: Details) => Response
  attachWindowOpenHandler(access, tab, { id: 7, setWindowOpenHandler: (registered: typeof handler) => { handler = registered } } as unknown as WebContents)
  return { open: (details: Details) => handler(details), createTab, observation, onActionFailed, agentInput }
}

const details: Details = { url: 'https://accounts.example/sign-in', disposition: 'new-window', referrer: { url: 'https://app.example/', policy: 'strict-origin-when-cross-origin' } }

describe('a window a workspace page opens', () => {
  it('lets Chromium create it, with the page script every tab has, and shows that page in a new tab', async () => {
    const { open, createTab, observation } = fixture()
    const response = open(details)
    // A page's window.open() features, such as javascript=no, cannot change them.
    expect(response).toMatchObject({
      action: 'allow',
      outlivesOpener: true,
      overrideBrowserWindowOptions: {
        webPreferences: { ...PAGE_PREFERENCES, javascript: true, webviewTag: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false }
      }
    })
    expect(createTab).not.toHaveBeenCalled()

    const guest = guestPage()
    const webPreferences = { ...PAGE_PREFERENCES, partition: 'persist:workspace-client' }
    expect(response.createWindow!({ webContents: guest, webPreferences })).toBe(guest)
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({
      url: details.url,
      active: true,
      mcpGroupId: 'client',
      // The two pages can reach each other, so the new tab remembers its opener's.
      adopt: { webContents: guest, webPreferences, openerTabId: 'opener' }
    }))
    // Chromium sends the referrer and any form post to the page it created.
    expect(createTab.mock.calls[0]![0]).not.toHaveProperty('loadOptions')
    expect(observation.stop(() => true)).toEqual({ tabIds: ['popup'] })
    expect(guest.close).not.toHaveBeenCalled()
  })

  it('closes the page Chromium created when no tab can show it', async () => {
    const { open, observation, onActionFailed } = fixture({ createTab: async () => { throw new Error('Too many tabs') } })
    const guest = guestPage()
    open(details).createWindow!({ webContents: guest })
    await vi.waitFor(() => expect(guest.close).toHaveBeenCalledTimes(1))
    expect(onActionFailed).toHaveBeenCalledWith('open page in new tab', expect.objectContaining({ message: 'Too many tabs' }))
    expect(observation.stop(() => true)).toEqual({ tabIds: [], failed: 1 })
  })

  it('keeps the tab of a page that failed after adopting it, which closes the page itself', async () => {
    const guest = guestPage()
    const { open } = fixture({
      createTab: async (tabOptions) => {
        tabOptions.onCreated?.({ id: 'popup', webContents: guest })
        throw new Error('Layout failed')
      }
    })
    open(details).createWindow!({ webContents: guest })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(guest.close).not.toHaveBeenCalled()
  })

  it('does not link a page opened without an opener, such as from a target="_blank" link', () => {
    const { open, createTab } = fixture()
    const guest = guestPage({ opener: false })
    open({ ...details, disposition: 'background-tab' }).createWindow!({ webContents: guest })
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({ active: false, adopt: { webContents: guest, webPreferences: undefined } }))
  })

  it('decides whether to show the tab when the page asks, while the agent\'s input that asked still runs', () => {
    const { open, createTab, agentInput } = fixture()
    agentInput.set(7, 1)
    const response = open(details)
    agentInput.clear()
    response.createWindow!({ webContents: guestPage() })
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({ selectVisible: false }))
  })

  it('blocks Home and addresses the workspace does not allow', () => {
    const home = fixture()
    expect(home.open({ ...details, url: 'hronaut://home/' })).toEqual({ action: 'deny' })
    expect(home.observation.stop(() => true)).toEqual({ tabIds: [], blocked: 1 })
    const denied = fixture({ allowed: false })
    expect(denied.open(details)).toEqual({ action: 'deny' })
    expect(denied.createTab).not.toHaveBeenCalled()
  })
})

describe('a window a page outside a workspace opens', () => {
  it('still loads its address in a new tab, with its referrer and form post', () => {
    const { open, createTab } = fixture({ mcpGroupId: undefined })
    const postBody = { data: [{ type: 'rawData', bytes: Buffer.from('q=1') }], contentType: 'application/x-www-form-urlencoded' }
    expect(open({ ...details, postBody })).toEqual({ action: 'deny' })
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({
      url: details.url,
      loadOptions: { httpReferrer: details.referrer, postData: postBody.data, extraHeaders: 'Content-Type: application/x-www-form-urlencoded' }
    }))
  })
})
