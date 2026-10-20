import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { attachNavigationEvents } from '../src/main/browser/tab-events/navigation-events.js'

/** A stand-in for whatever the handlers call on the tab manager: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' ? undefined : stand,
    apply: () => stand
  })
  return stand
}

/** A page at an address whose visits the tab records, as the tab manager records them in the history. */
function page(url: string) {
  let address = url
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => address,
    getTitle: () => 'Router app',
    isLoading: () => false,
    isLoadingMainFrame: () => false,
    isDestroyed: () => false
  })
  const tab = {
    id: 'tab', url: 'about:blank', title: 'New tab', loading: false, sleeping: false,
    discoveryTitle: anything(), navigationGeneration: 0, faviconRequestId: 0, pendingHistoryUrl: null as string | null,
    suppressInitialHistory: false, navigationPolicyDenialSequence: 0, emulationContextGeneration: 0
  }
  const visits: string[] = []
  const recordVisit = vi.fn((visited: { url: string }) => { visits.push(visited.url) })
  const fallback = anything() as Record<string | symbol, unknown>
  const access = new Proxy({}, { get: (_target, key) => key === 'recordVisit' ? recordVisit : key === 'isDestroyed' ? () => false : fallback[key] })
  attachNavigationEvents(access as never, tab as never, contents as never)
  const open = () => { contents.emit('did-navigate', {}, address) }
  const inPage = (next: string) => { address = next; contents.emit('did-navigate-in-page', {}, next, true) }
  const ready = () => { contents.emit('dom-ready') }
  return { tab, visits, open, inPage, ready }
}

describe('visits a page records', () => {
  it('records no visit for a change within the page that keeps its address', () => {
    // history.replaceState(state, '') counted a visit each time, so a router saving its scroll position showed
    // "11 visits" after one load, moved the page to the top of the history and rewrote the history file each time.
    const { visits, open, inPage, ready } = page('https://app.example/inbox')
    open()
    ready()
    for (let count = 0; count < 10; count += 1) inPage('https://app.example/inbox')
    expect(visits).toEqual(['https://app.example/inbox'])
  })

  it('still records the first visit when the page keeps its address before it is ready', () => {
    const { visits, open, inPage, ready } = page('https://app.example/inbox')
    open()
    inPage('https://app.example/inbox')
    ready()
    expect(visits).toEqual(['https://app.example/inbox'])
  })

  it('records a change within the page to another address, such as a route or a section', () => {
    const { visits, open, inPage, ready } = page('https://app.example/inbox')
    open()
    ready()
    inPage('https://app.example/settings')
    inPage('https://app.example/settings#privacy')
    expect(visits).toEqual(['https://app.example/inbox', 'https://app.example/settings', 'https://app.example/settings#privacy'])
  })
})
