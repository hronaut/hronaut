import type { Session } from 'electron'
import { expect, it, vi } from 'vitest'
import type { SessionHooksAccess, SessionHooksTab } from '../src/main/browser/session-hooks/session-hooks-access.js'

vi.mock('electron', () => ({ safeStorage: {} }))

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
  } as unknown as SessionHooksTab
  const notify = vi.fn()
  const access: SessionHooksAccess<SessionHooksTab> = {
    isDestroyed: () => false,
    tabs: () => [tab].values(),
    findTab: (tabId) => tabId === 'tab' ? tab : undefined,
    tabIdForWebContents: (id) => id === 7 ? 'tab' : undefined,
    browserSessionAuthorityHooks: () => new Map(),
    browserCookieImportSessions: () => new Set(),
    networkHookSessions: () => new WeakSet(),
    changed: vi.fn(),
    networkWaitController: () => ({ notify }),
    downloadController: () => ({ attachSession: vi.fn() })
  }
  installSessionHooks(access, browserSession)
  return { webRequest, listeners, tab, notify }
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
