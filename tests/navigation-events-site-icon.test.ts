import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
// The browser below is a stand-in that answers every call; these functions ask it instead of reading its fields.
vi.mock('../src/main/browser/site-muting/site-muting.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/site-muting/site-muting.js')>(),
  applySiteMuting: (browser: { applySiteMuting: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.applySiteMuting(...args)
}))
vi.mock('../src/main/browser/tab-events/page-visits.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-events/page-visits.js')>(),
  recordVisit: vi.fn()
}))
import { TabDiscoveryTitle } from '../src/main/browser/tab-discovery-title.js'
import { attachNavigationEvents } from '../src/main/browser/tab-events/navigation-events.js'

/** A stand-in for whatever the handlers call on the tab manager: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' ? undefined : stand,
    apply: () => stand
  })
  return stand
}

// History and Bookmarks show each page with the first icon its document gave, and a route a single-page app goes to is
// a page of its own that gets that icon too. A link to a section of a page is the same page, which the history keeps
// without its fragment, so it gives no icon.
it('gives a route of the page the page\'s first icon, and a section of the page nothing', () => {
  const contents = Object.assign(new EventEmitter(), {
    url: 'https://mail.example/inbox',
    getURL: () => contents.url,
    getTitle: () => 'Inbox',
    isLoading: () => false,
    isLoadingMainFrame: () => false,
    isDestroyed: () => false,
    executeJavaScript: async () => undefined,
    executeJavaScriptInIsolatedWorld: async () => null
  })
  const tab = {
    id: 'tab', url: 'about:blank', title: 'New Tab', loading: false, sleeping: false, discoveryTitle: new TabDiscoveryTitle(),
    navigationGeneration: 0, documentGeneration: 0, faviconRequestId: 0, pendingHistoryUrl: null, suppressInitialHistory: false,
    navigationPolicyDenialSequence: 0, emulationContextGeneration: 0, webContents: contents,
    siteIconSource: undefined as { documentGeneration: number; requestId: number; icon: string } | undefined
  }
  const onSiteIcon = vi.fn<(page: { url: string; icon: string }) => void>()
  const fallback = anything() as Record<string | symbol, unknown>
  const options = new Proxy({}, { get: (_target, key) => key === 'onSiteIcon' ? onSiteIcon : fallback[key] })
  const browser = new Proxy({}, { get: (_target, key) => key === 'destroyed' ? false : key === 'options' ? options : fallback[key] })
  attachNavigationEvents(browser as never, tab as never, contents as never)
  const changeWithinPage = (url: string) => {
    contents.url = url
    contents.emit('did-navigate-in-page', {}, url, true)
  }

  contents.emit('did-navigate', {}, contents.url)
  contents.emit('dom-ready')
  tab.siteIconSource = { documentGeneration: tab.documentGeneration, requestId: 1, icon: 'data:image/png;base64,aW5ib3g=' }

  changeWithinPage('https://mail.example/inbox#unread')
  expect(onSiteIcon).not.toHaveBeenCalled()
  changeWithinPage('https://mail.example/inbox/42#reply')
  expect(onSiteIcon.mock.calls).toEqual([[{ url: 'https://mail.example/inbox/42#reply', icon: 'data:image/png;base64,aW5ib3g=' }]])
})
