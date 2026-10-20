import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { attachNavigationEvents } from '../src/main/browser/tab-events/navigation-events.js'

/** A stand-in for whatever the handlers call on the tab manager: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' ? undefined : stand,
    apply: () => stand
  })
  return stand
}

/** A page whose address and Chromium title the case sets, a tab that listens to it, and the visits it records. */
function page(url: string, title: string) {
  const contents = Object.assign(new EventEmitter(), {
    url,
    title,
    getURL: () => contents.url,
    getTitle: () => contents.title,
    isLoading: () => false,
    isLoadingMainFrame: () => false,
    isDestroyed: () => false
  })
  const tab = {
    id: 'tab', url: 'about:blank', title: 'New Tab', loading: false, sleeping: false,
    discoveryTitle: anything(), navigationGeneration: 0, faviconRequestId: 0, pendingHistoryUrl: null,
    suppressInitialHistory: false, navigationPolicyDenialSequence: 0, emulationContextGeneration: 0
  }
  const visits: Array<{ url: string; title: string }> = []
  const fallback = anything() as Record<string | symbol, unknown>
  const answers: Record<string | symbol, unknown> = {
    isDestroyed: () => false,
    recordVisit: (visited: typeof tab) => visits.push({ url: visited.url, title: visited.title })
  }
  const access = new Proxy({}, { get: (_target, key) => answers[key] ?? fallback[key] })
  attachNavigationEvents(access as never, tab as never, contents as never)
  const open = () => {
    contents.emit('did-navigate', {}, contents.url)
    contents.emit('dom-ready')
  }
  /** A change of address within the page, such as `history.replaceState`, for which Chromium sends no title update. */
  const changeWithinPage = (nextUrl: string, nextTitle: string) => {
    contents.url = nextUrl
    contents.title = nextTitle
    contents.emit('did-navigate-in-page', {}, nextUrl, true)
  }
  return { tab, visits, open, changeWithinPage }
}

describe('a tab\'s title after a change within its page', () => {
  it('names an untitled page by its new address, without the fragment of the old one', () => {
    const callback = page('https://app.example/oauth/callback#access_token=in-page-secret', 'app.example/oauth/callback#access_token=in-page-secret')

    callback.open()
    callback.changeWithinPage('https://app.example/dashboard', 'app.example/dashboard')
    // The visit to the dashboard was recorded, and the tab kept, with the callback's address and token as its title.
    expect(callback.visits.at(-1)).toEqual({ url: 'https://app.example/dashboard', title: 'app.example/dashboard' })
    expect(callback.tab.title).toBe('app.example/dashboard')
  })

  it('keeps the page\'s own title', () => {
    const inbox = page('https://mail.example/inbox', 'Inbox')

    inbox.open()
    inbox.changeWithinPage('https://mail.example/inbox/42', 'Inbox')
    expect(inbox.visits).toEqual([
      { url: 'https://mail.example/inbox', title: 'Inbox' },
      { url: 'https://mail.example/inbox/42', title: 'Inbox' }
    ])
  })
})
