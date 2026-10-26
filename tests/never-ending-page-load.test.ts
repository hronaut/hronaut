import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { navigate, reload } from '../src/main/browser/page-navigation/page-navigation.js'
import { PAGE_LOAD_WAIT_MS } from '../src/main/browser/page-waits/page-load-limit.js'
import { putTabToSleep, wakeTab } from '../src/main/browser/tab-sleep/tab-sleep.js'

// A page whose load never ends, such as one with an image its server never answers, held browser_navigate, the
// address bar and every agent call on a sleeping tab for as long as the page kept loading: Electron settles a load
// only at the page's load event. The e2e probe that found it drove the real app with such an image.

const SLEEPING_PAGE_URL = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ESleeping%20tab%3C%2Ftitle%3E'
const ADDRESS = 'http://127.0.0.1:3000/app'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** Settles to what the promise did by now, without waiting for it. */
async function stateOf(promise: Promise<unknown>): Promise<'pending' | 'resolved' | 'rejected'> {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending'
  promise.then(() => { state = 'resolved' }, () => { state = 'rejected' })
  await vi.advanceTimersByTimeAsync(0)
  return state
}

describe('opening an address whose page never finishes loading', () => {
  /** A tab whose load never ends; it shows the new page when `shows` is set, or keeps the page it showed. */
  function tabLoadingForever(shows: boolean) {
    const webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isCrashed: () => false,
      loadURL: vi.fn(() => {
        if (shows) webContents.emit('did-navigate', {}, 'https://next.example/')
        return new Promise<void>(() => {})
      })
    })
    const tab = { id: 'tab', navigationGeneration: 0, documentGeneration: 0, navigationPolicyDenialSequence: 0, sleeping: false, webContents }
    const access = {
      getTab: () => tab,
      findTab: (id: string) => (id === tab.id ? tab : undefined),
      searchEngine: () => undefined,
      prepareDiagnosticNavigation: vi.fn(),
      confirmLeavePage: vi.fn(),
      getState: () => ({ ok: true })
    }
    return { webContents, go: (byPerson?: boolean) => navigate(access as never, 'https://next.example/', undefined, { byPerson }) }
  }

  it.each([false, true])('returns once the wait has passed, leaving the page loading (by a person: %s)', async byPerson => {
    const { go, webContents } = tabLoadingForever(true)
    const navigation = go(byPerson)
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS - 1)
    expect(await stateOf(navigation)).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await expect(navigation).resolves.toEqual({ ok: true })
    expect(webContents.loadURL).toHaveBeenCalledOnce()
    expect(webContents.listenerCount('will-prevent-unload')).toBe(0)
    expect(webContents.listenerCount('will-frame-navigate')).toBe(0)
    expect(webContents.listenerCount('did-navigate')).toBe(0)
  })

  it('tells an agent when the page has not shown by then, so it does not read the page it left', async () => {
    const navigation = tabLoadingForever(false).go(false)
    const outcome = expect(navigation).rejects.toMatchObject({ message: 'Timed out waiting for the page to finish loading.' })
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
    await outcome
  })

  it('lets a person go on with the tab still loading when the page has not shown by then', async () => {
    const navigation = tabLoadingForever(false).go(true)
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
    await expect(navigation).resolves.toEqual({ ok: true })
  })
})

describe('retrying a failed page whose load never ends', () => {
  it('tells the caller once the wait has passed, leaving the page loading', async () => {
    const webContents = { loadURL: vi.fn(() => new Promise<void>(() => {})) }
    const tab = { id: 'tab', sleeping: false, pageProblem: { kind: 'load-error', url: ADDRESS }, webContents }
    const access = {
      getTab: () => tab,
      isRendererRecovering: () => false,
      prepareDiagnosticNavigation: vi.fn(),
      changed: vi.fn(),
      waitForPage: vi.fn(() => new Promise<void>(() => {})),
      getState: () => ({ ok: true })
    }
    const retry = reload(access as never)
    const outcome = expect(retry).rejects.toMatchObject({ message: 'Timed out waiting for the page to finish loading.' })
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS - 1)
    expect(await stateOf(retry)).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await outcome
    expect(webContents.loadURL).toHaveBeenCalledWith(ADDRESS, undefined)
    expect(access.waitForPage).not.toHaveBeenCalled()
  })
})

describe('waking a tab whose page never finishes loading', () => {
  /**
   * A sleeping tab whose load never ends. It commits the page `commits` names, or nothing when it is null. With
   * `slept`, the tab went to sleep on its page, so waking goes back to it in its history.
   */
  function sleepingTab(commits: string | null, slept = false) {
    const entries = slept ? [ADDRESS, SLEEPING_PAGE_URL] : ['about:blank', SLEEPING_PAGE_URL]
    let index = 1
    const webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isLoading: () => true,
      getURL: () => entries[index],
      loadURL: vi.fn(() => {
        if (commits !== null) {
          entries.splice(index + 1, entries.length, commits)
          index += 1
        }
        return new Promise<void>(() => {})
      }),
      navigationHistory: {
        length: () => entries.length,
        getActiveIndex: () => index,
        getEntryAtIndex: (at: number) => (at in entries ? { url: entries[at] } : undefined),
        goToIndex: vi.fn((at: number) => {
          if (commits !== null) index = at
        }),
        removeEntryAtIndex: (at: number) => {
          entries.splice(at, 1)
          if (at < index) index -= 1
        }
      }
    })
    const tab = {
      id: 'tab', url: ADDRESS, sleeping: true, loading: false, suppressInitialHistory: false, pendingHistoryUrl: null as string | null,
      navigationGeneration: 3, pinned: false, pageLifecycleState: 'active',
      lastActiveAt: 0, sleepNavigationHistory: { entries: [], index: 0 }, webContents, wakePromise: undefined as Promise<void> | undefined
    }
    const access = {
      getTab: () => tab,
      findTab: (id: string) => (id === tab.id ? tab : undefined),
      hasTab: (id: string) => id === tab.id,
      activeTabId: () => undefined,
      splitViewContains: () => false,
      tabOverviewSleepPreviews: () => new Map(),
      changed: vi.fn(),
      getState: () => ({ tabs: [] })
    }
    return {
      tab, entries, webContents,
      wake: () => wakeTab(access as never, tab.id),
      sleep: () => putTabToSleep(access as never, tab as never, false)
    }
  }

  it.each([false, true])('lets the caller go on once the page shows, with the tab awake and the sleeping page out of its history (back in history: %s)', async slept => {
    const { tab, entries, webContents, wake } = sleepingTab(ADDRESS, slept)
    const first = wake()
    const joined = wake()
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS - 1)
    expect(await stateOf(first)).toBe('pending')
    expect(await stateOf(joined)).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await expect(first).resolves.toBeDefined()
    await expect(joined).resolves.toBeDefined()
    expect(tab.sleeping).toBe(false)
    expect(entries).toEqual(slept ? [ADDRESS] : ['about:blank', ADDRESS])
    expect(slept ? webContents.navigationHistory.goToIndex : webContents.loadURL).toHaveBeenCalledOnce()
  })

  it('ends the wake for later callers, and records the next page the tab opens', async () => {
    const { tab, wake } = sleepingTab(ADDRESS)
    const first = wake()
    // The woken page commits while its load goes on; it is not a visit.
    tab.pendingHistoryUrl = ADDRESS
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
    await expect(first).resolves.toBeDefined()
    expect(tab.wakePromise).toBeUndefined()
    expect(tab.suppressInitialHistory).toBe(false)
    expect(tab.pendingHistoryUrl).toBeNull()
    expect(await stateOf(wake())).toBe('resolved')
  })

  it('leaves the page its callers went on with when its load fails later', async () => {
    const { webContents, wake } = sleepingTab(ADDRESS, true)
    await Promise.all([wake(), vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)])
    // The connection that kept the page loading resets.
    webContents.emit('did-fail-load', {}, -101, 'ERR_CONNECTION_RESET', ADDRESS, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(webContents.loadURL).not.toHaveBeenCalled()
  })

  it('lets a sleep sweep during the wake go on once the page shows', async () => {
    const { wake, sleep } = sleepingTab(ADDRESS)
    void wake()
    const sweep = sleep()
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
    // The page still loads, which keeps the tab awake.
    await expect(sweep).resolves.toBe(false)
  })

  it('fails the wait while the tab still shows the sleeping page', async () => {
    const { tab, wake, sleep } = sleepingTab(null)
    const waking = wake()
    const outcome = expect(waking).rejects.toMatchObject({ message: 'Timed out waiting for the page to finish loading.' })
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
    await outcome
    // The page goes on loading in the tab; a later call joins the same wake, and a sleep sweep leaves the tab.
    expect(tab.sleeping).toBe(false)
    expect(tab.wakePromise).toBeDefined()
    const sweep = sleep()
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
    await expect(sweep).resolves.toBe(false)
  })
})
