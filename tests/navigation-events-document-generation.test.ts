import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
// The browser below is a stand-in that answers every call; these functions ask it instead of reading its fields.
vi.mock('../src/main/browser/site-muting/site-muting.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/site-muting/site-muting.js')>(),
  applySiteMuting: (browser: { applySiteMuting: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.applySiteMuting(...args)
}))
vi.mock('../src/main/browser/native-selections/native-selections.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/native-selections/native-selections.js')>(),
  cancelNativeSelectionSessions: (browser: { cancelNativeSelectionSessions: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.cancelNativeSelectionSessions(...args)
}))
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  workspaceNavigationAllowed: (browser: { workspaceNavigationAllowed: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.workspaceNavigationAllowed(...args)
}))
// A failed load asks for its page to load again later, which tests/network-error-reload.test.ts covers.
vi.mock('../src/main/browser/network-error-reload/network-error-reload.js', () => ({ reloadWhenWebsiteReachable: vi.fn() }))
import { attachNavigationEvents } from '../src/main/browser/tab-events/navigation-events.js'

// The fake browser stubs these, which are functions now; the mock reaches its stubs.
vi.mock('../src/main/browser/background-action.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/background-action.js')>(),
  runWalletLifecycleAction: (browser: { runWalletLifecycleAction: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.runWalletLifecycleAction(...args)
}))

// Find in page ends its search when the tab's document generation changes. Find once closed on the tab's navigation
// generation, which advances as a navigation starts: a Find opened while the next page was still loading searched the
// old page, so when the next page replaced it, Find stayed open with the old page's matches and Chromium repeated the
// query on the new page. The document generation advances only when another document replaces the page.

/** A stand-in for whatever the handlers call on the tab manager: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' ? undefined : stand,
    apply: () => stand
  })
  return stand
}

/** A page's events and a tab that listens to them, with the wallet navigations it reports. */
function page() {
  const walletNavigations: number[] = []
  const cancelSelections = vi.fn()
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'https://start.example/',
    getTitle: () => 'Start',
    isLoading: () => false,
    isLoadingMainFrame: () => false,
    isDestroyed: () => false
  })
  const tab = {
    id: 'tab', url: 'https://start.example/', title: 'Start', loading: false, sleeping: false, mcpGroupId: 'workspace',
    discoveryTitle: anything(), navigationGeneration: 0, walletNavigationGeneration: 0, documentGeneration: 0,
    faviconRequestId: 0, pendingHistoryUrl: null, suppressInitialHistory: false, navigationPolicyDenialSequence: 0,
    emulationContextGeneration: 0, consoleMessages: []
  }
  const fallback = anything() as Record<string | symbol, unknown>
  const browser = new Proxy({}, {
    get: (_target, key) => key === 'workspaceNavigationAllowed' ? () => true
      : key === 'options' ? { getLocale: () => 'en-US', onWalletNavigation: (_tabId: string, generation: number) => { walletNavigations.push(generation) } }
      : key === 'runWalletLifecycleAction' ? (_label: string, action: () => unknown) => { action() }
      : key === 'cancelNativeSelectionSessions' ? cancelSelections
      : fallback[key]
  })
  attachNavigationEvents(browser as never, tab as never, contents as never)
  return { contents, tab, walletNavigations, cancelSelections }
}

describe('the document generation Find in page closes on', () => {
  it('advances when another page replaces the page, not while it only loads', () => {
    const { contents, tab } = page()

    contents.emit('did-start-navigation', {}, 'https://next.example/', false, true)
    expect(tab.documentGeneration).toBe(0)
    contents.emit('did-navigate', {}, 'https://next.example/')
    expect(tab.documentGeneration).toBe(1)
  })

  // A link that starts a download, or that the server answers with no content, keeps the page; Find closed on it, so a
  // person who clicked a download link among the matches lost them, which Chrome keeps.
  it('stays for a navigation that never replaces the page, such as a download', () => {
    const { contents, tab } = page()

    contents.emit('did-start-navigation', {}, 'https://start.example/release.zip', false, true)
    contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://start.example/release.zip', true)
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://start.example/release.zip', true)
    contents.emit('did-start-navigation', {}, 'https://start.example/empty', false, true)
    contents.emit('did-stop-loading')
    expect(tab.documentGeneration).toBe(0)
    expect(tab.navigationGeneration).toBe(2)
  })

  // A pick on a page that started a download ended without removing its overlay from the page, which kept the pointer
  // and swallowed the next click.
  it('ends an element pick or area selection when another document replaces the page, not when a navigation starts', () => {
    const { contents, cancelSelections } = page()

    contents.emit('did-start-navigation', {}, 'https://start.example/release.zip', false, true)
    contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://start.example/release.zip', true)
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://start.example/release.zip', true)
    expect(cancelSelections).not.toHaveBeenCalled()
    contents.emit('did-start-navigation', {}, 'https://next.example/', false, true)
    contents.emit('did-navigate', {}, 'https://next.example/')
    expect(cancelSelections).toHaveBeenCalledOnce()
    contents.emit('did-start-navigation', {}, 'https://gone.example/', false, true)
    contents.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://gone.example/', true)
    contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://gone.example/', true)
    expect(cancelSelections).toHaveBeenCalledTimes(2)
  })

  it('advances when a failed load shows its error page, not for a load another one replaced', () => {
    const { contents, tab } = page()

    contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://next.example/', true)
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://next.example/', true)
    expect(tab.documentGeneration).toBe(0)
    contents.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://next.example/', true)
    contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://next.example/', true)
    expect(tab.documentGeneration).toBe(1)
  })

  // The page stays, so Find stays with its matches.
  it('stays when a page that replaced the last one then fails to receive the rest of its content', () => {
    const { contents, tab } = page()

    contents.emit('did-start-navigation', {}, 'https://next.example/', false, true)
    contents.emit('did-navigate', {}, 'https://next.example/')
    contents.emit('did-fail-load', {}, -355, 'ERR_INCOMPLETE_CHUNKED_ENCODING', 'https://next.example/', true)
    expect(tab.documentGeneration).toBe(1)
  })

  it('stays for a change within the page and for embedded frames', () => {
    const { contents, tab } = page()

    contents.emit('did-start-navigation', {}, 'https://start.example/#setup', true, true)
    contents.emit('did-navigate-in-page', {}, 'https://start.example/#setup', true)
    contents.emit('did-start-navigation', {}, 'https://frame.example/', false, false)
    contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://frame.example/', false)
    expect(tab.documentGeneration).toBe(0)
    expect(tab.navigationGeneration).toBe(1)
  })
})

// Wallet requests belong to the document that made them. A link that starts a download, or that the server answers
// with no content, starts a navigation that never commits, so the page and its pending wallet requests stay. Before,
// the generation followed navigations as they started: a request the old page made meanwhile was credited to the next
// page, and a page that committed while a newer navigation had already started was never counted at all.
describe('the wallet navigation generation', () => {
  it('stays while another page is only loading and advances, once, when it replaces the page', () => {
    const { contents, tab, walletNavigations } = page()

    contents.emit('did-start-navigation', {}, 'https://start.example/download', false, true)
    expect(tab.walletNavigationGeneration).toBe(0)
    expect(walletNavigations).toEqual([])
    contents.emit('did-start-navigation', {}, 'https://next.example/', false, true)
    contents.emit('did-navigate', {}, 'https://next.example/')
    expect(tab.walletNavigationGeneration).toBe(1)
    expect(walletNavigations).toEqual([1])
  })

  it('advances for each page that replaces another, also when a newer navigation has already started', () => {
    const { contents, tab, walletNavigations } = page()

    contents.emit('did-start-navigation', {}, 'https://next.example/', false, true)
    contents.emit('did-start-navigation', {}, 'https://later.example/', false, true)
    contents.emit('did-navigate', {}, 'https://next.example/')
    expect(tab.walletNavigationGeneration).toBe(1)
    contents.emit('did-navigate', {}, 'https://later.example/')
    expect(tab.walletNavigationGeneration).toBe(2)
    expect(walletNavigations).toEqual([1, 2])
  })

  it('advances when an error page replaces the page, not for a load that was aborted', () => {
    const { contents, tab, walletNavigations } = page()

    contents.emit('did-start-navigation', {}, 'https://next.example/', false, true)
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://next.example/', true)
    expect(walletNavigations).toEqual([])
    contents.emit('did-start-navigation', {}, 'https://next.example/', false, true)
    contents.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://next.example/', true)
    contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://next.example/', true)
    expect(tab.walletNavigationGeneration).toBe(1)
    expect(walletNavigations).toEqual([1])
  })

  it('stays when a page that replaced the last one then fails to receive the rest of its content', () => {
    const { contents, tab, walletNavigations } = page()

    contents.emit('did-start-navigation', {}, 'https://next.example/', false, true)
    contents.emit('did-navigate', {}, 'https://next.example/')
    contents.emit('did-start-navigation', {}, 'https://next.example/?routed', true, true)
    contents.emit('did-navigate-in-page', {}, 'https://next.example/?routed', true)
    contents.emit('did-fail-load', {}, -355, '', 'https://next.example/?routed', true)
    expect(tab.walletNavigationGeneration).toBe(1)
    expect(walletNavigations).toEqual([1])
  })

  it('stays for a change within the page, for embedded frames and while the tab sleeps', () => {
    const { contents, tab, walletNavigations } = page()

    contents.emit('did-start-navigation', {}, 'https://start.example/#setup', true, true)
    contents.emit('did-navigate-in-page', {}, 'https://start.example/#setup', true)
    contents.emit('did-start-navigation', {}, 'https://frame.example/', false, false)
    contents.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://frame.example/', false)
    contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://frame.example/', false)
    tab.sleeping = true
    contents.emit('did-navigate', {}, 'about:blank')
    contents.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://next.example/', true)
    expect(tab.walletNavigationGeneration).toBe(0)
    expect(walletNavigations).toEqual([])
  })
})
