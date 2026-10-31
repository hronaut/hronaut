import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
// The browser below stubs workspaceNavigationAllowed, which checks the workspace's sites before a window opens.
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  workspaceNavigationAllowed: (browser: { workspaceNavigationAllowed: (...args: unknown[]) => boolean }, ...args: unknown[]) => browser.workspaceNavigationAllowed(...args)
}))
import { OpenedTabObservation } from '../src/main/browser/click-opened-tabs.js'
import { attachWindowOpenHandler } from '../src/main/browser/tab-events/window-open-handler.js'
import { pageWebPreferences } from '../src/main/browser/new-tabs/tab-admission.js'

// Checking that the workspace can take a tab is a function now; it reaches the fake's stub.
vi.mock('../src/main/browser/new-tabs/tab-admission.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/new-tabs/tab-admission.js')>(),
  assertCanCreateTab: (browser: { assertCanCreateTab: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.assertCanCreateTab(...args)
}))

// A website's sign-in popup got no window: Hronaut denied every new window and loaded its address in a new tab, so
// window.open() returned null and the new page had no window.opener to send the result back to.

interface Details { url: string; disposition: string; referrer: { url: string; policy: string }; postBody?: unknown }
interface Response {
  action: 'allow' | 'deny'
  outlivesOpener?: boolean
  overrideBrowserWindowOptions?: { webPreferences?: Record<string, unknown> }
  createWindow?: (options: { webContents: WebContents; webPreferences?: Record<string, unknown> }) => WebContents
}

/** How the browser creates a tab for the new page, which it hands over as soon as the tab exists. */
type CreateTab = (tabOptions: { onCreated?: (tab: { id: string; sleeping: boolean }) => void }) => Promise<unknown>

/** Hronaut's text as its keys, which is all these tests need of it. */
const text = (key: string): string => key
const PAGE_PREFERENCES = pageWebPreferences({ text } as never)

/** The page Chromium created for the window; window.open() gives it an opener, a target="_blank" link does not. */
function guestPage(options: { opener?: boolean } = {}): WebContents & { close: ReturnType<typeof vi.fn> } {
  return { isDestroyed: vi.fn(() => false), close: vi.fn(), opener: options.opener === false ? null : { url: 'https://app.example/' } } as unknown as WebContents & { close: ReturnType<typeof vi.fn> }
}

function fixture(options: {
  mcpGroupId?: string; allowed?: boolean; canOpenTab?: () => void; createTab?: CreateTab
  shownTab?: { id: string; mcpGroupId?: string }; splitTabId?: string
} = {}) {
  const agentInput = new Map<number, number>()
  const tab = {
    id: 'opener',
    sleeping: false,
    lastHumanInteractionAt: Number.NEGATIVE_INFINITY,
    agentCallStartedAt: Number.NEGATIVE_INFINITY,
    ...('mcpGroupId' in options ? { mcpGroupId: options.mcpGroupId } : { mcpGroupId: 'client' })
  }
  // The person sees the page that opens the window, unless a test says otherwise.
  const shown = options.shownTab ?? tab
  const observation = new OpenedTabObservation()
  const onActionFailed = vi.fn()
  const createTab = vi.fn<CreateTab>(options.createTab ?? (async (tabOptions) => {
    const created = { id: 'popup', sleeping: false }
    tabOptions.onCreated?.(created)
    return created
  }))
  const browser = {
    openedTabObservations: new Map([[tab, new Set([observation])]]),
    workspaceNavigationAllowed: () => options.allowed ?? true,
    options: { onActionFailed },
    assertCanCreateTab: vi.fn(options.canOpenTab ?? (() => undefined)),
    createTab,
    text,
    agentInputWebContents: agentInput,
    mcpActivitiesByTab: new Map<string, Set<string>>(),
    tabs: new Map<string, { mcpGroupId?: string; pageFullscreen?: boolean }>([[tab.id, tab], [shown.id, shown]]),
    activeTabId: shown.id,
    splitView: options.splitTabId ? { firstTabId: shown.id, secondTabId: options.splitTabId } : null,
    splitViewContains: (tabId: string) => tabId === options.splitTabId
  }
  let handler!: (details: Details) => Response
  attachWindowOpenHandler(browser as never, tab as never, { id: 7, setWindowOpenHandler: (registered: typeof handler) => { handler = registered } } as unknown as WebContents)
  return {
    tab, browser, open: (details: Details) => handler(details), createTab, observation, onActionFailed, agentInput,
    assertCanCreateTab: browser.assertCanCreateTab
  }
}

const details: Details = { url: 'https://accounts.example/sign-in', disposition: 'new-window', referrer: { url: 'https://app.example/', policy: 'strict-origin-when-cross-origin' } }

describe('a window a workspace page opens', () => {
  it('lets Chromium create it, with the page script every tab has, and shows that page in a new tab', async () => {
    const { open, createTab, observation, assertCanCreateTab } = fixture()
    const response = open(details)
    // A workspace that cannot take a tab now refuses the window too.
    expect(assertCanCreateTab).toHaveBeenCalledExactlyOnceWith('client', false)
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
        tabOptions.onCreated?.({ id: 'popup', sleeping: false })
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

  it('opens it behind a tab the person sees, unless they just clicked or typed in its page', () => {
    // A window that a page in a tab behind opened, such as on a timer, was shown in place of the page the person was
    // looking at, and took the keys they typed. Chrome's pop-up blocker refuses a window opened without the person's
    // click or key press.
    const behind = fixture({ shownTab: { id: 'other', mcpGroupId: 'client' } })
    behind.open(details).createWindow!({ webContents: guestPage() })
    expect(behind.createTab).toHaveBeenCalledWith(expect.objectContaining({
      active: false,
      selectVisible: false,
      openedFrom: { tabId: 'opener', background: true, window: true }
    }))
    // A split view shows both its pages.
    const split = fixture({ shownTab: { id: 'other', mcpGroupId: 'client' }, splitTabId: 'opener' })
    split.open(details).createWindow!({ webContents: guestPage() })
    expect(split.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: true }))
    // A page the person clicked moments ago, such as one that opens its window once a request answers, may still open
    // it in front after they moved to another tab, as Chromium lets that click open a window for a few seconds.
    const clicked = fixture({ shownTab: { id: 'other', mcpGroupId: 'client' } })
    clicked.tab.lastHumanInteractionAt = performance.now()
    clicked.open(details).createWindow!({ webContents: guestPage() })
    expect(clicked.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: true }))
  })

  it('opens it behind from a split pane hidden by the other pane\'s page in full screen', () => {
    // The pane's window took the view, which ended the full screen of the page the person was watching.
    const hidden = fixture({ shownTab: { id: 'other', mcpGroupId: 'client' }, splitTabId: 'opener' })
    hidden.browser.tabs.get('other')!.pageFullscreen = true
    hidden.open(details).createWindow!({ webContents: guestPage() })
    expect(hidden.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: false, selectVisible: false }))
    // The pane's own page in full screen is the one the person sees.
    const filling = fixture({ shownTab: { id: 'other', mcpGroupId: 'client' }, splitTabId: 'opener' })
    filling.browser.tabs.get('opener')!.pageFullscreen = true
    filling.open(details).createWindow!({ webContents: guestPage() })
    expect(filling.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: true }))
    // A click in the hidden pane moments before still opens its window in front.
    const clicked = fixture({ shownTab: { id: 'other', mcpGroupId: 'client' }, splitTabId: 'opener' })
    clicked.browser.tabs.get('other')!.pageFullscreen = true
    clicked.tab.lastHumanInteractionAt = performance.now()
    clicked.open(details).createWindow!({ webContents: guestPage() })
    expect(clicked.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: true }))
  })

  it('makes it its workspace\'s tab without showing it, from a page in a workspace the person does not see', () => {
    // As before, an agent working there finds the window its page opened after the agent's call answered as the
    // workspace's tab; it no longer takes the person to that workspace.
    const { open, createTab } = fixture({ shownTab: { id: 'other', mcpGroupId: 'mine' } })
    open(details).createWindow!({ webContents: guestPage() })
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: false }))
  })

  it('decides whether its page is in view when the page asks, not when Chromium creates the window', () => {
    const { browser, open, createTab } = fixture()
    const response = open(details)
    browser.activeTabId = 'other'
    response.createWindow!({ webContents: guestPage() })
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: true }))
  })

  it('makes the tab its workspace\'s without showing it, for an agent\'s tool call on the page the person sees', () => {
    // An agent's script that opened a window from the page in view took the view and the person's keyboard with it,
    // as the person's own click does; an agent's click already left it unshown.
    const { browser, open, createTab } = fixture()
    browser.mcpActivitiesByTab.set('opener', new Set(['evaluate']))
    open(details).createWindow!({ webContents: guestPage() })
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: false }))
    // Also in a pane of the split view, and behind for a background-tab disposition.
    const split = fixture({ shownTab: { id: 'other', mcpGroupId: 'client' }, splitTabId: 'opener' })
    split.browser.mcpActivitiesByTab.set('opener', new Set(['evaluate']))
    split.open(details).createWindow!({ webContents: guestPage() })
    expect(split.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: false }))
    const background = fixture()
    background.browser.mcpActivitiesByTab.set('opener', new Set(['evaluate']))
    background.open({ ...details, disposition: 'background-tab' }).createWindow!({ webContents: guestPage() })
    expect(background.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: false, selectVisible: false }))
  })

  it('shows the window the person opens with a click or key press in the page while an agent\'s call on it runs', () => {
    const clicked = fixture()
    clicked.browser.mcpActivitiesByTab.set('opener', new Set(['wait']))
    clicked.tab.agentCallStartedAt = performance.now() - 1_000
    clicked.tab.lastHumanInteractionAt = performance.now()
    clicked.open(details).createWindow!({ webContents: guestPage() })
    expect(clicked.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: true }))
    // Their key press just before the agent's call began does not make its window theirs.
    const typedBefore = fixture()
    typedBefore.browser.mcpActivitiesByTab.set('opener', new Set(['evaluate']))
    typedBefore.tab.lastHumanInteractionAt = performance.now() - 1_000
    typedBefore.tab.agentCallStartedAt = performance.now()
    typedBefore.open(details).createWindow!({ webContents: guestPage() })
    expect(typedBefore.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: false }))
    // Nor does any click while the agent's input runs.
    const input = fixture()
    input.agentInput.set(7, 1)
    input.tab.lastHumanInteractionAt = performance.now()
    input.open(details).createWindow!({ webContents: guestPage() })
    expect(input.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: false }))
  })

  it('decides whether the agent\'s call asked for the window when the page asks, while the call still runs', () => {
    const { browser, open, createTab } = fixture()
    browser.mcpActivitiesByTab.set('opener', new Set(['evaluate']))
    const response = open(details)
    browser.mcpActivitiesByTab.clear()
    response.createWindow!({ webContents: guestPage() })
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({ selectVisible: false }))
  })

  it('makes the tab its workspace\'s without showing it, for an agent\'s tool call on a page behind', () => {
    // As for the agent's input, Follow agents shows it through the agent's calls on it.
    const { browser, open, createTab } = fixture({ shownTab: { id: 'other', mcpGroupId: 'client' } })
    browser.mcpActivitiesByTab.set('opener', new Set(['evaluate']))
    open(details).createWindow!({ webContents: guestPage() })
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({ active: true, selectVisible: false }))
  })

  it('gives the page no window when the workspace cannot take another tab, as for a blocked popup', () => {
    const { open, createTab, observation, onActionFailed } = fixture({ canOpenTab: () => { throw new Error('Too many tabs') } })
    expect(open(details)).toEqual({ action: 'deny' })
    expect(createTab).not.toHaveBeenCalled()
    expect(onActionFailed).toHaveBeenCalledWith('open page in new tab', expect.objectContaining({ message: 'Too many tabs' }))
    expect(observation.stop(() => true)).toEqual({ tabIds: [], failed: 1 })
  })

  it('opens no window from a tab going to sleep, whose page still runs until the sleeping page replaces it', () => {
    const { tab, open, createTab } = fixture()
    tab.sleeping = true
    expect(open(details)).toEqual({ action: 'deny' })
    expect(createTab).not.toHaveBeenCalled()
  })

  it('places the tab beside the tab that opened it, behind for a background-tab disposition', () => {
    // A link opened in a new tab went after the workspace's last tab, far from the page that opened it.
    const front = fixture()
    front.open({ ...details, disposition: 'foreground-tab' }).createWindow!({ webContents: guestPage({ opener: false }) })
    expect(front.createTab).toHaveBeenCalledWith(expect.objectContaining({ openedFrom: { tabId: 'opener', background: false, window: false } }))
    const behind = fixture()
    behind.open({ ...details, disposition: 'background-tab' }).createWindow!({ webContents: guestPage({ opener: false }) })
    expect(behind.createTab).toHaveBeenCalledWith(expect.objectContaining({ openedFrom: { tabId: 'opener', background: true, window: false } }))
    // A window that asked for its own size or position, such as a sign-in popup, is one Chrome opens apart from the tabs.
    const popup = fixture()
    popup.open(details).createWindow!({ webContents: guestPage() })
    expect(popup.createTab).toHaveBeenCalledWith(expect.objectContaining({ openedFrom: { tabId: 'opener', background: false, window: true } }))
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

  it('opens it behind a tab the person sees', () => {
    const { open, createTab } = fixture({ mcpGroupId: undefined, shownTab: { id: 'other' } })
    open(details)
    expect(createTab).toHaveBeenCalledWith(expect.objectContaining({ active: false, selectVisible: false }))
  })
})
