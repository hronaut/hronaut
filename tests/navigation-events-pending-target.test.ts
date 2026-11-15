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
import { attachNavigationEvents } from '../src/main/browser/tab-events/navigation-events.js'

/** A stand-in for whatever the handlers call on the tab manager: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' ? undefined : stand,
    apply: () => stand
  })
  return stand
}

/** A page's events, a tab that listens to them, and the tab manager answers the listeners need. */
function page(options: { redirectAllowed?: boolean } = {}) {
  const contents = Object.assign(new EventEmitter(), {
    loadingMainFrame: true,
    getURL: () => 'https://start.example/',
    getTitle: () => 'Start',
    isLoading: () => contents.loadingMainFrame,
    isLoadingMainFrame: () => contents.loadingMainFrame,
    isDestroyed: () => false
  })
  const tab = {
    id: 'tab', url: 'https://start.example/', title: 'Start', loading: false, sleeping: false, mcpGroupId: 'workspace',
    discoveryTitle: anything(), navigationGeneration: 0, faviconRequestId: 0, pendingHistoryUrl: null,
    suppressInitialHistory: false, navigationPolicyDenialSequence: 0, emulationContextGeneration: 0, consoleMessages: []
  } as { pendingMainFrameUrl?: string }
  const fallback = anything() as Record<string | symbol, unknown>
  const browser = new Proxy({}, {
    get: (_target, key) => key === 'workspaceNavigationAllowed' ? () => options.redirectAllowed !== false : fallback[key]
  })
  attachNavigationEvents(browser as never, tab as never, contents as never)
  const start = (url: string, sameDocument = false, mainFrame = true) => contents.emit('did-start-navigation', {}, url, sameDocument, mainFrame)
  const redirect = (url: string) => contents.emit('will-redirect', { url, isMainFrame: true, preventDefault: () => undefined })
  return { contents, tab, start, redirect }
}

describe('where a tab is headed', () => {
  it('follows a page navigation through its redirects until it opens', () => {
    const { contents, tab, start, redirect } = page()

    start('https://a.example/')
    expect(tab.pendingMainFrameUrl).toBe('https://a.example/')
    redirect('https://b.example/')
    expect(tab.pendingMainFrameUrl).toBe('https://b.example/')
    contents.emit('did-navigate', {}, 'https://b.example/')
    expect(tab.pendingMainFrameUrl).toBeUndefined()
  })

  it('keeps the target when a redirect is refused', () => {
    const { tab, start, redirect } = page({ redirectAllowed: false })

    start('https://a.example/')
    redirect('https://blocked.example/')
    expect(tab.pendingMainFrameUrl).toBe('https://a.example/')
  })

  it('ignores navigations within the page and in embedded frames', () => {
    const { tab, start } = page()

    start('https://start.example/#section', true)
    start('https://frame.example/', false, false)
    expect(tab.pendingMainFrameUrl).toBeUndefined()
  })

  it('forgets a navigation that fails, but not a newer one that replaced it', () => {
    const { contents, tab, start } = page()

    start('https://a.example/')
    start('https://b.example/')
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://a.example/', true)
    expect(tab.pendingMainFrameUrl).toBe('https://b.example/')
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://b.example/', true)
    expect(tab.pendingMainFrameUrl).toBeUndefined()
  })

  it('forgets a navigation that ends without opening a page, such as a download', () => {
    const { contents, tab, start } = page()

    start('https://start.example/report.pdf')
    contents.loadingMainFrame = false
    contents.emit('did-stop-loading')
    expect(tab.pendingMainFrameUrl).toBeUndefined()
  })
})
