import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
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
    discoveryTitle: new TabDiscoveryTitle(), navigationGeneration: 0, faviconRequestId: 0, pendingHistoryUrl: null,
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
  /** Loads the page; a title the page sets itself is reported to the tab, as Electron does. */
  const open = (pageTitle?: string) => {
    contents.emit('did-navigate', {}, contents.url)
    if (pageTitle) contents.emit('page-title-updated', {}, pageTitle, true)
    contents.emit('dom-ready')
  }
  /** A change of address within the page, for which Chromium sends no title update; Chromium's title stays as set. */
  const changeWithinPage = (nextUrl: string, nextTitle = contents.title) => {
    contents.url = nextUrl
    contents.title = nextTitle
    contents.emit('did-navigate-in-page', {}, nextUrl, true)
  }
  return { tab, visits, open, changeWithinPage }
}

describe('a tab\'s title after a change within its page', () => {
  it('names an untitled page by its new address after replaceState, without the fragment of the old one', () => {
    const callback = page('http://127.0.0.1:3000/oauth/callback#access_token=in-page-secret', '127.0.0.1:3000/oauth/callback#access_token=in-page-secret')

    callback.open()
    // Chromium keeps the callback's address as the title of the address that replaced it.
    callback.changeWithinPage('http://127.0.0.1:3000/dashboard')
    // The visit to the dashboard was recorded, and the tab kept, with the callback's address and token as its title.
    expect(callback.visits.at(-1)).toEqual({ url: 'http://127.0.0.1:3000/dashboard', title: '127.0.0.1:3000/dashboard' })
    expect(callback.tab.title).toBe('127.0.0.1:3000/dashboard')
    // A second replacement still finds Chromium's title is the callback's address.
    callback.changeWithinPage('http://127.0.0.1:3000/dashboard?view=week')
    expect(callback.tab.title).toBe('127.0.0.1:3000/dashboard?view=week')
    // The history store keeps the token out of the callback's own visit; the later ones never carry it.
    expect(callback.visits.slice(1).map(({ title }) => title).join(' ')).not.toContain('in-page-secret')
  })

  it('takes the name Chromium gives an untitled page\'s new address after pushState', () => {
    const callback = page('https://app.example/oauth/callback#access_token=in-page-secret', 'https://app.example/oauth/callback#access_token=in-page-secret')

    callback.open()
    callback.changeWithinPage('https://app.example/', 'https://app.example')
    expect(callback.tab.title).toBe('https://app.example')
  })

  it('keeps the page\'s own title, also one that names its site', () => {
    const inbox = page('https://mail.example/inbox', 'Inbox')
    inbox.open('Inbox')
    inbox.changeWithinPage('https://mail.example/inbox/42')
    expect(inbox.visits).toEqual([
      { url: 'https://mail.example/inbox', title: 'Inbox' },
      { url: 'https://mail.example/inbox/42', title: 'Inbox' }
    ])

    const booking = page('https://www.booking.example/', 'Booking.example')
    booking.open('Booking.example')
    booking.changeWithinPage('https://www.booking.example/hotels')
    expect(booking.tab.title).toBe('Booking.example')
  })
})
