import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
// The browser below stubs withDebugger and changed, which request conditions run through and publish with; the
// network emulation they reapply is a stub of its own.
const { applyNetworkEmulation } = vi.hoisted(() => ({
  applyNetworkEmulation: vi.fn<(contents: unknown, network: unknown, routes: unknown, send?: (method: string) => Promise<unknown>) => Promise<void>>()
}))
vi.mock('../src/main/browser/emulation/network-emulation.js', () => ({ applyNetworkEmulation }))
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/debugger-lease/debugger-lease.js')>(),
  withDebugger: (browser: { withDebugger: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.withDebugger(...args)
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist)
}))
import type { WebContents } from 'electron'
import { addNetworkRoute, moveNetworkRoute, removeNetworkRoute, setNetworkRouteEnabled } from '../src/main/browser/network-conditions/network-conditions.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { isNetworkRouteRefusal, normalizeNetworkRouteInput } from '../src/main/browser/network-route-input.js'
import { LocalizedError } from '../src/main/localized-error.js'
import { translate } from '../src/shared/i18n.js'

function conditions(routeCount = 0) {
  const debuggerEvents = Object.assign(new EventEmitter(), {
    sendCommand: async () => ({}),
    detach: () => undefined,
    isAttached: () => true
  })
  const contents = Object.assign(new EventEmitter(), { id: 7, debugger: debuggerEvents, isDestroyed: () => false }) as unknown as WebContents
  const tab = {
    id: 'tab-1',
    url: 'https://app.test/page',
    webContents: contents,
    networkRoutes: Array.from({ length: routeCount }, (_, index) => ({
      ...normalizeNetworkRouteInput({ urlPattern: `https://app.test/never/${index}`, abort: 'Failed' }),
      id: `route-${index}`,
      createdAt: '2026-10-20T12:00:00.000Z'
    })),
    networkConditionApplication: 'confirmed',
    networkConditionEpoch: 0,
    networkDebuggerEpoch: 0,
    mainFrameId: 'main',
    emulation: { network: 'none' as never }
  } as unknown as BrowserTab
  applyNetworkEmulation.mockImplementation(async () => {})
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    destroyed: false,
    withDebugger: async <T>(_contents: unknown, operation: () => Promise<T>, admission?: () => void): Promise<T> => { admission?.(); return operation() },
    networkRouteQueues: new Map(),
    networkRouteRefreshTimers: new Map(),
    heldNetworkResponseStates: new Map(),
    changed: () => {}
  } as unknown as Browser
  return { browser, tab }
}

async function failure(operation: Promise<unknown>): Promise<LocalizedError> {
  const error = await operation.then(() => undefined, (cause: unknown) => cause)
  expect(error).toBeInstanceOf(LocalizedError)
  // browser_network_routes gives agents a refusal's message; it was dropped for every one of these.
  expect(isNetworkRouteRefusal(error)).toBe(true)
  return error as LocalizedError
}

// Request conditions showed these in English in every interface language, in words written for agents.
it('names a full tab for the Network panel and keeps its English message', async () => {
  const { browser, tab } = conditions(50)
  const error = await failure(addNetworkRoute(browser, 'tab-1', { urlPattern: 'https://app.test/over-limit', abort: 'Failed' }))
  expect(error.key).toBe('appErrors.networkConditions.limitReached')
  expect(error.parameters).toEqual({ max: 50 })
  expect(error.message).toBe('Network route limit reached (50)')
  expect(translate('fr-FR', error.key, error.parameters)).toBe('Un onglet peut avoir au plus 50 conditions de requête. Supprimez-en une avant d’en ajouter une autre.')
  expect(tab.networkRoutes).toHaveLength(50)
})

it('names a condition removed meanwhile for the Network panel and keeps its English message', async () => {
  const { browser } = conditions(1)
  for (const change of [
    setNetworkRouteEnabled(browser, 'tab-1', 'missing', false),
    removeNetworkRoute(browser, 'tab-1', 'missing'),
    moveNetworkRoute(browser, 'tab-1', 'missing', 'up')
  ]) {
    const error = await failure(change)
    expect(error.key).toBe('appErrors.networkConditions.conditionGone')
    expect(error.message).toBe('Network route not found: missing')
  }
})

it('names Hronaut Home for the Network panel and keeps its English message', async () => {
  const { browser, tab } = conditions()
  tab.url = 'hronaut://home/'
  const error = await failure(addNetworkRoute(browser, 'tab-1', { urlPattern: 'https://app.test/*', abort: 'Failed' }))
  expect(error.key).toBe('appErrors.networkConditions.websiteTab')
  expect(error.message).toBe('Open a website tab before adding a network route')
  expect(tab.networkRoutes).toEqual([])
})

it('refuses a fifth held request with a message agents read', async () => {
  const { browser, tab } = conditions()
  tab.networkRoutes = Array.from({ length: 4 }, (_, index) => ({
    ...normalizeNetworkRouteInput({ urlPattern: `https://app.test/held/${index}`, response: {}, holdUntilReleased: true }),
    id: `held-${index}`,
    createdAt: '2026-10-20T12:00:00.000Z'
  }))
  const error = await addNetworkRoute(browser, 'tab-1', { urlPattern: 'https://app.test/held/more', response: {}, holdUntilReleased: true })
    .then(() => undefined, (cause: unknown) => cause)
  expect(isNetworkRouteRefusal(error)).toBe(true)
  expect((error as Error).message).toBe('A tab can hold at most 4 requests, counting hold rules not matched yet. Release or cancel one first.')
  expect(tab.networkRoutes).toHaveLength(4)
})
