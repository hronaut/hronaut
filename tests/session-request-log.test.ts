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

it('records a request that failed before it was sent, and records each request once', () => {
  const { listeners, tab } = hookedSession()
  listeners.errorOccurred!({ ...request, error: 'net::ERR_NAME_NOT_RESOLVED' })
  listeners.sendHeaders!({ ...request, id: 42 })
  listeners.errorOccurred!({ ...request, id: 42, error: 'net::ERR_CONNECTION_REFUSED' })
  expect(tab.networkRequests.map(({ id, error }) => ({ id, error }))).toEqual([
    { id: 'web:41', error: 'net::ERR_NAME_NOT_RESOLVED' },
    { id: 'web:42', error: 'net::ERR_CONNECTION_REFUSED' }
  ])
})

it('leaves the requests of a page whose debugger records them to the debugger', () => {
  const { listeners, tab } = hookedSession(true)
  listeners.sendHeaders!(request)
  listeners.errorOccurred!({ ...request, id: 42, error: 'net::ERR_FAILED' })
  expect(tab.networkRequests).toEqual([])
})
