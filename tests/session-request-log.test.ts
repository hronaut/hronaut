import type { Session } from 'electron'
import { expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'

vi.mock('electron', () => ({ safeStorage: {} }))
/** What the page loaded besides its own document, as certificate errors hear of it, for the session made last. */
const loaded = vi.hoisted(() => ({ content: (_certificates: { changed(): void }, _tab: unknown, _url: string): void => undefined }))
vi.mock('../src/main/browser/certificate-errors/certificate-errors.js', () => ({
  contentLoaded: (certificates: { changed(): void }, tab: unknown, url: string) => loaded.content(certificates, tab, url)
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist)
}))

const { installSessionHooks } = await import('../src/main/browser/session-hooks/session-hooks.js')

type Listener = (details: Record<string, unknown>) => void

/** A session with one tab, whose request hooks a test calls as Chromium would. */
function hookedSession(debuggerRecords = false) {
  const listeners: Record<string, Listener> = {}
  const listen = (name: string) => vi.fn((listener: Listener) => { listeners[name] = listener })
  const webRequest = {
    onBeforeRequest: listen('beforeRequest'),
    onBeforeSendHeaders: listen('beforeSendHeaders'),
    onHeadersReceived: listen('headersReceived'),
    onSendHeaders: listen('sendHeaders'),
    onBeforeRedirect: listen('beforeRedirect'),
    onCompleted: listen('completed'),
    onErrorOccurred: listen('errorOccurred')
  }
  const browserSession = { cookies: { on: vi.fn() }, webRequest } as unknown as Session
  const tab = {
    webContents: { session: browserSession, isDestroyed: () => false },
    browserSessionGeneration: 0,
    networkDebuggerEnabled: debuggerRecords,
    networkRequests: [],
    networkCaptureSequence: 0,
    observationGeneration: 1
  } as unknown as BrowserTab
  const notify = vi.fn()
  const contentLoaded = vi.fn((certificates: { changed(): void }, _tab: unknown, _url: string) => { certificates.changed() })
  loaded.content = contentLoaded
  const certificatesChanged = vi.fn()
  const browser = {
    destroyed: false,
    tabs: new Map([['tab', tab]]),
    webContentsToTab: new Map([[7, 'tab']]),
    browserSessionAuthorityHooks: new Map(),
    browserCookieImportSessions: new Set(),
    networkHookSessions: new WeakSet(),
    changed: vi.fn(),
    certificatesChanged,
    networkWaitController: { notify },
    downloadController: { attachSession: vi.fn() }
  } as unknown as Browser
  installSessionHooks(browser, browserSession)
  return { webRequest, listeners, tab, notify, contentLoaded, certificatesChanged }
}

const request = { id: 41, url: 'https://example.test/app.js', method: 'GET', resourceType: 'script', timestamp: Date.parse('2026-10-26T16:00:00.000Z'), webContentsId: 7 }

it('records a page\'s requests before its debugger does without holding any of them', () => {
  // A listener with a callback made every request of every tab wait for Hronaut's main process, which is busiest
  // while many pages load at once.
  const { webRequest, listeners, tab, notify } = hookedSession()
  for (const blocking of [webRequest.onBeforeRequest, webRequest.onBeforeSendHeaders, webRequest.onHeadersReceived]) expect(blocking).not.toHaveBeenCalled()
  listeners.sendHeaders!(request)
  listeners.completed!({ ...request, statusCode: 200, fromCache: false })
  expect(tab.networkRequests).toEqual([expect.objectContaining({
    id: 'web:41',
    url: 'https://example.test/app.js',
    method: 'GET',
    resourceType: 'script',
    startedAt: '2026-10-26T16:00:00.000Z',
    status: 200,
    responseSource: 'network',
    detailsAvailable: false
  })])
  expect(notify).toHaveBeenCalledTimes(2)
})

it('tells what a page loaded besides its own document, for any tab, so a page showing content that is not private says so', () => {
  for (const debuggerRecords of [false, true]) {
    const { listeners, tab, contentLoaded, certificatesChanged } = hookedSession(debuggerRecords)
    listeners.completed!({ ...request, statusCode: 200, fromCache: true })
    listeners.completed!({ ...request, url: 'https://example.test/frame', resourceType: 'subFrame', statusCode: 200, fromCache: false })
    listeners.completed!({ ...request, url: 'https://example.test/', resourceType: 'mainFrame', statusCode: 200, fromCache: false })
    listeners.completed!({ ...request, webContentsId: undefined, statusCode: 200, fromCache: false })
    expect(contentLoaded.mock.calls.map(([, page, url]) => [page, url]), String(debuggerRecords)).toEqual([[tab, 'https://example.test/app.js'], [tab, 'https://example.test/frame']])
    // What it loaded can make the page not private, which the tab's certificate state then shows.
    expect(certificatesChanged.mock.calls, String(debuggerRecords)).toEqual([[tab], [tab]])
  }
})

it('keeps a record for each address a redirected request goes to, as the debugger does', () => {
  // A redirect sends the request again under the same id: its target used to be left out, or recorded and never
  // completed, while the first address took the final status.
  const { listeners, tab, notify } = hookedSession()
  listeners.sendHeaders!({ ...request, url: 'https://example.test/old', method: 'POST', resourceType: 'mainFrame' })
  listeners.beforeRedirect!({ ...request, url: 'https://example.test/old', statusCode: 303, fromCache: false, redirectURL: 'https://example.test/new' })
  listeners.sendHeaders!({ ...request, url: 'https://example.test/new', method: 'GET', resourceType: 'mainFrame' })
  listeners.beforeRedirect!({ ...request, url: 'https://example.test/new', statusCode: 302, fromCache: true, redirectURL: 'https://example.test/end' })
  listeners.sendHeaders!({ ...request, url: 'https://example.test/end', method: 'GET', resourceType: 'mainFrame' })
  listeners.completed!({ ...request, url: 'https://example.test/end', statusCode: 200, fromCache: false })
  expect(tab.networkRequests.map(({ id, url, method, status, responseSource, completedAt }) => ({ id, url, method, status, responseSource, completed: completedAt !== undefined }))).toEqual([
    { id: 'web:41', url: 'https://example.test/old', method: 'POST', status: 303, responseSource: 'network', completed: true },
    { id: 'web:41-1', url: 'https://example.test/new', method: 'GET', status: 302, responseSource: 'other-cache', completed: true },
    { id: 'web:41-2', url: 'https://example.test/end', method: 'GET', status: 200, responseSource: 'network', completed: true }
  ])
  expect(notify).toHaveBeenCalledTimes(6)
})

it('records how a request failed, and leaves a request whose record was cleared out of the log', () => {
  const { listeners, tab, notify } = hookedSession()
  listeners.sendHeaders!(request)
  listeners.errorOccurred!({ ...request, error: 'net::ERR_CONNECTION_REFUSED' })
  expect(tab.networkRequests.map(({ id, error }) => ({ id, error }))).toEqual([{ id: 'web:41', error: 'net::ERR_CONNECTION_REFUSED' }])
  expect(notify).toHaveBeenCalledTimes(2)
  // A navigation clears the log while the previous page's requests are still open; their ends do not bring them back.
  listeners.sendHeaders!({ ...request, id: 42 })
  listeners.sendHeaders!({ ...request, id: 43 })
  tab.networkRequests.splice(0)
  listeners.errorOccurred!({ ...request, id: 42, error: 'net::ERR_ABORTED' })
  listeners.completed!({ ...request, id: 43, statusCode: 200, fromCache: false })
  expect(tab.networkRequests).toEqual([])
})

it('completes a request it recorded after the debugger starts recording, and leaves the rest to the debugger', () => {
  const { listeners, tab } = hookedSession()
  listeners.sendHeaders!(request)
  tab.networkDebuggerEnabled = true
  listeners.sendHeaders!({ ...request, id: 42 })
  listeners.completed!({ ...request, statusCode: 204, fromCache: false })
  listeners.errorOccurred!({ ...request, id: 42, error: 'net::ERR_FAILED' })
  expect(tab.networkRequests.map(({ id, status }) => ({ id, status }))).toEqual([{ id: 'web:41', status: 204 }])
})
