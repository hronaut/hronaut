import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/**
 * A tab whose page the case loads, reloads and retitles, with the history entry Electron reports as active, and what
 * the tab gives the history: its visits, each opening another page or the same one again, and its title updates.
 */
function tabPage(options: { restored?: boolean } = {}) {
  const contents = Object.assign(new EventEmitter(), {
    url: 'about:blank',
    title: '',
    loading: false,
    entryIndex: -1,
    entryCount: 0,
    /** The addresses of the history entries, as far as the case gave them. */
    entryUrls: [] as string[],
    getURL: () => contents.url,
    getTitle: () => contents.title,
    isLoading: () => contents.loading,
    isLoadingMainFrame: () => contents.loading,
    isDestroyed: () => false,
    navigationHistory: {
      getActiveIndex: () => contents.entryIndex,
      length: () => contents.entryCount || contents.entryIndex + 1,
      getEntryAtIndex: (index: number) => contents.entryUrls[index] === undefined ? null : { url: contents.entryUrls[index], title: '' }
    }
  })
  const tab = {
    id: 'tab', url: 'about:blank', title: 'New Tab', loading: false, sleeping: false,
    discoveryTitle: new TabDiscoveryTitle(), navigationGeneration: 0, faviconRequestId: 0, pendingHistoryUrl: null,
    suppressInitialHistory: options.restored === true, navigationPolicyDenialSequence: 0, emulationContextGeneration: 0,
    documentGeneration: 0, walletNavigationGeneration: 0
  }
  const visits: Array<{ url: string; samePage: boolean }> = []
  const titles: string[] = []
  const fallback = anything() as Record<string | symbol, unknown>
  const answers: Record<string | symbol, unknown> = {
    isDestroyed: () => false,
    recordVisit: (visited: typeof tab, samePage: boolean) => visits.push({ url: visited.url, samePage }),
    options: () => ({ getLocale: () => 'en', onPageTitleUpdated: ({ title }: { title: string }) => titles.push(title) })
  }
  const access = new Proxy({}, { get: (_target, key) => answers[key] ?? fallback[key] })
  attachNavigationEvents(access as never, tab as never, contents as never)

  /**
   * Commits a document at an address and history entry, which stays loading and becomes ready unless told not to. As in
   * Electron, a tab that is loading already does not start loading again.
   */
  const commit = (url: string, entryIndex: number, title = 'Page', ready = true) => {
    contents.url = url
    contents.title = title
    contents.entryIndex = entryIndex
    contents.entryUrls[entryIndex] = url
    if (!contents.loading) contents.emit('did-start-loading')
    contents.loading = true
    contents.emit('did-navigate', {}, url)
    if (ready) contents.emit('dom-ready')
  }
  const ready = () => { contents.emit('dom-ready') }
  /** The main frame finishes loading, and with it the page. */
  const stopLoading = () => {
    contents.loading = false
    contents.emit('did-finish-load')
    contents.emit('did-stop-loading')
  }
  /** An embedded frame loads, which Electron reports as the page loading. */
  const loadFrame = () => {
    contents.loading = true
    contents.emit('did-start-loading')
    contents.loading = false
    contents.emit('did-stop-loading')
  }
  /** Loads a document completely. */
  const load = (url: string, entryIndex: number, title = 'Page') => {
    commit(url, entryIndex, title)
    stopLoading()
  }
  const setTitle = (title: string) => {
    contents.title = title
    contents.emit('page-title-updated', {}, title, true)
  }
  /** A change of address within the page, such as a router's pushState, which adds a history entry. */
  const changeWithinPage = (url: string, entryIndex: number) => {
    contents.url = url
    contents.entryIndex = entryIndex
    contents.entryUrls[entryIndex] = url
    contents.emit('did-navigate-in-page', {}, url, true)
  }
  const setEntryCount = (count: number) => { contents.entryCount = count }
  /** An embedded frame loads another document, which adds an entry to the tab's history. */
  const navigateFrame = (url: string) => {
    contents.entryIndex += 1
    contents.entryCount = contents.entryIndex + 1
    contents.emit('did-frame-navigate', {}, url, 200, 'OK', false, 1, 2)
  }
  /** Hronaut removes an entry before the active one, which moves the active entry one place back. */
  const removeEarlierEntry = () => {
    contents.entryCount = (contents.entryCount || contents.entryIndex + 1) - 1
    contents.entryIndex -= 1
    contents.entryUrls.splice(0, 1)
  }
  /** The pages a restored tab's history keeps before the page it loads again. */
  const restoreEarlierEntries = (urls: string[]) => { contents.entryUrls.splice(0, urls.length, ...urls) }
  /** A navigation that never commits, such as a download, aborts its load. */
  const abortNavigation = (url: string) => { contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', url, true) }
  /** Waking the tab loads its page again. */
  const wake = () => { tab.suppressInitialHistory = true }
  /** Memory Saver puts the loaded tab to sleep, which loads its sleeping page into another history entry. */
  const fallAsleep = () => {
    tab.sleeping = true
    commit('data:text/html,sleeping', contents.entryIndex + 1, 'Sleeping', false)
  }
  /** The person selects the tab while its sleeping page still loads, and it goes back to its page. */
  const wakeWhileAsleepLoads = (url: string, entryIndex: number, title: string) => {
    tab.sleeping = false
    tab.suppressInitialHistory = true
    commit(url, entryIndex, title)
  }
  /** A wake whose page shows but goes on loading ends for its callers, as for the history: the next page is a visit. */
  const stopWaitingForWake = () => {
    tab.suppressInitialHistory = false
    tab.pendingHistoryUrl = null
  }
  return {
    visits, titles, commit, ready, load, stopLoading, loadFrame, setTitle, changeWithinPage, setEntryCount, navigateFrame,
    removeEarlierEntry, restoreEarlierEntries, abortNavigation, wake, stopWaitingForWake, fallAsleep, wakeWhileAsleepLoads
  }
}

describe('visits a tab gives the history', () => {
  it('opens the same page again when the tab reloads it, which is not another visit', () => {
    // Every reload counted a visit, so a page reloaded 20 times showed "21 visits" and led Most visited.
    const page = tabPage()
    page.load('http://localhost:3000/', 0)
    for (let reload = 0; reload < 3; reload += 1) page.load('http://localhost:3000/', 0)
    expect(page.visits).toEqual([
      { url: 'http://localhost:3000/', samePage: false },
      { url: 'http://localhost:3000/', samePage: true },
      { url: 'http://localhost:3000/', samePage: true },
      { url: 'http://localhost:3000/', samePage: true }
    ])
  })

  it('counts a visit to another entry with the same address, such as going back to it', () => {
    const page = tabPage()
    page.load('https://news.example/', 0)
    page.load('https://news.example/story', 1)
    page.load('https://news.example/', 0)
    page.load('https://news.example/', 1)
    expect(page.visits.map((visit) => visit.samePage)).toEqual([false, false, false, false])
  })

  it('counts a reload of a route as the same page, and a route of its own as another', () => {
    const page = tabPage()
    page.load('https://app.example/inbox', 0)
    page.changeWithinPage('https://app.example/settings', 1)
    page.load('https://app.example/settings', 1)
    expect(page.visits).toEqual([
      { url: 'https://app.example/inbox', samePage: false },
      { url: 'https://app.example/settings', samePage: false },
      { url: 'https://app.example/settings', samePage: true }
    ])
  })

  it('counts a first visit that a reload or a hash router changes before the page is ready', () => {
    // The page was not yet a visit, so marking it the same page again left it uncounted.
    const reloaded = tabPage()
    reloaded.commit('https://slow.example/', 0, 'Slow', false)
    reloaded.load('https://slow.example/', 0, 'Slow')
    expect(reloaded.visits).toEqual([{ url: 'https://slow.example/', samePage: false }])

    const routed = tabPage()
    routed.commit('https://app.example/', 0, 'App', false)
    routed.changeWithinPage('https://app.example/#/', 1)
    expect(routed.visits).toEqual([{ url: 'https://app.example/#/', samePage: false }])
  })

  it('counts a visit to the same address in a tab with as many entries as Chromium keeps, which reuses the last index', () => {
    // A form that posts back to its page, in a tab with 50 entries, looked like a reload.
    const page = tabPage()
    page.setEntryCount(50)
    page.load('https://admin.example/item/1', 49)
    page.load('https://admin.example/item/1', 49)
    expect(page.visits.map((visit) => visit.samePage)).toEqual([false, false])
  })

  it('counts a reload after an embedded frame added an entry, or after an earlier entry was removed, as the same page', () => {
    // An embedded editor or ad that loaded another document moved the tab to another entry, so a reload looked like a
    // visit to it, as did one after the sleeping page of a woken tab left the history.
    const framed = tabPage()
    framed.load('https://docs.example/edit', 0)
    framed.navigateFrame('https://ads.example/2')
    framed.load('https://docs.example/edit', 1)
    expect(framed.visits.map((visit) => visit.samePage)).toEqual([false, true])

    const woken = tabPage()
    woken.load('https://news.example/', 0)
    woken.load('https://news.example/story', 1)
    woken.removeEarlierEntry()
    woken.load('https://news.example/story', 0)
    expect(woken.visits.map((visit) => visit.samePage)).toEqual([false, false, true])
  })

  it('counts a reload of an earlier entry in a tab with as many entries as Chromium keeps as the same page', () => {
    const page = tabPage()
    page.setEntryCount(50)
    page.load('https://admin.example/item/1', 48)
    page.load('https://admin.example/item/1', 48)
    expect(page.visits.map((visit) => visit.samePage)).toEqual([false, true])
  })

  it('does not count the page a restored tab loads again, and counts the next one', () => {
    const page = tabPage({ restored: true })
    page.load('https://news.example/', 0)
    page.load('https://news.example/story', 1)
    expect(page.visits).toEqual([{ url: 'https://news.example/story', samePage: false }])
  })

  it('counts a page a restored tab opens before the page it loads again finishes loading', () => {
    // A restored page that went on loading, such as for a slow image, kept the tab from recording the page a link in it
    // opened, until a page finished loading.
    const page = tabPage({ restored: true })
    page.commit('https://shop.example/', 0, 'Shop')
    page.load('https://shop.example/cart', 1, 'Cart')
    page.load('https://shop.example/checkout', 2, 'Checkout')
    expect(page.visits).toEqual([
      { url: 'https://shop.example/cart', samePage: false },
      { url: 'https://shop.example/checkout', samePage: false }
    ])
  })

  it('counts a reload of the page a restored tab loads again as the same page', () => {
    const page = tabPage({ restored: true })
    page.commit('https://slow.example/', 0, 'Slow')
    page.load('https://slow.example/', 0, 'Slow')
    expect(page.visits).toEqual([{ url: 'https://slow.example/', samePage: true }])
  })

  it('does not count the page a tab loads again when it wakes once more after a wake that stopped waiting', () => {
    const page = tabPage({ restored: true })
    page.commit('https://chat.example/', 0, 'Chat')
    page.stopWaitingForWake()
    page.stopLoading()
    page.wake()
    page.load('https://chat.example/', 0, 'Chat')
    expect(page.visits).toEqual([])
  })

  it('does not count the page a tab wakes to while its sleeping page still loads', () => {
    // The tab still took the page it restored as loaded again, so the page it woke to counted as a new visit.
    const page = tabPage({ restored: true })
    page.load('https://chat.example/', 0, 'Chat')
    page.fallAsleep()
    page.wakeWhileAsleepLoads('https://chat.example/', 0, 'Chat')
    page.stopLoading()
    expect(page.visits).toEqual([])
  })

  it('counts a route a restored page pushes before it finishes loading, and not the page changing its own address', () => {
    const page = tabPage({ restored: true })
    page.commit('https://app.example/', 0, 'App')
    page.changeWithinPage('https://app.example/#/', 1)
    page.changeWithinPage('https://app.example/home', 1)
    page.changeWithinPage('https://app.example/orders', 2)
    page.stopLoading()
    expect(page.visits).toEqual([{ url: 'https://app.example/orders', samePage: false }])
  })

  it('counts a route a restored page pushes after clearing the history removed the pages before it', () => {
    // Clearing the history moved the page back in its history, so the route it pushed next took the page's own place
    // and was not counted.
    const page = tabPage({ restored: true })
    page.restoreEarlierEntries(['https://app.example/login', 'https://app.example/start'])
    page.commit('https://app.example/', 2, 'App')
    page.removeEarlierEntry()
    page.removeEarlierEntry()
    page.changeWithinPage('https://app.example/orders', 1)
    page.stopLoading()
    expect(page.visits).toEqual([{ url: 'https://app.example/orders', samePage: false }])
  })

  it('keeps a link to a section of the page one visit, as the history leaves fragments out', () => {
    const page = tabPage()
    page.load('https://docs.example/guide', 0)
    page.changeWithinPage('https://docs.example/guide#install', 1)
    page.changeWithinPage('https://docs.example/guide#usage', 2)
    page.changeWithinPage('https://docs.example/reference#usage', 3)
    expect(page.visits.map((visit) => visit.samePage)).toEqual([false, true, true, false])
  })
})

describe('titles a tab gives the history', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 23, 12))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a title the page sets while it loads or in the 5 s after, and not one it sets later to get attention', () => {
    // An unread count, a chat message or a timer in the title replaced the page's name in the history, and a title
    // that changed every second rewrote the history file every second.
    const page = tabPage()
    page.commit('https://mail.example/', 0, 'Loading')
    page.setTitle('Inbox')
    page.stopLoading()
    vi.advanceTimersByTime(4_000)
    page.setTitle('Inbox - mail.example')
    vi.advanceTimersByTime(1_000)
    page.setTitle('(1) Inbox - mail.example')
    page.setTitle('(1) New message from Bob')
    expect(page.titles).toEqual(['Inbox', 'Inbox - mail.example'])
  })

  it('keeps at most 10 titles of a page, and 10 more of the next one', () => {
    const page = tabPage()
    page.commit('https://timer.example/', 0, 'Timer')
    for (let second = 20; second > 0; second -= 1) page.setTitle(`00:${String(second).padStart(2, '0')}`)
    expect(page.titles).toEqual(['00:20', '00:19', '00:18', '00:17', '00:16', '00:15', '00:14', '00:13', '00:12', '00:11'])
    page.commit('https://timer.example/done', 1, 'Done')
    page.setTitle('Finished')
    expect(page.titles.at(-1)).toBe('Finished')
  })

  it('keeps the titles a loading page sets after a download it started, which does not end its load', () => {
    const page = tabPage()
    page.commit('https://reports.example/', 0, 'Reports')
    page.abortNavigation('https://reports.example/export.csv')
    vi.advanceTimersByTime(6_000)
    page.setTitle('Reports - 12 ready')
    expect(page.titles).toEqual(['Reports - 12 ready'])
  })

  it('does not take a title set long after the page loaded while an embedded frame loads', () => {
    // Electron reports a frame's load as the page loading, so a chat page with a refreshing ad frame kept getting its
    // unread counts into the history.
    const page = tabPage()
    page.load('https://chat.example/', 0, 'Chat')
    vi.advanceTimersByTime(60_000)
    page.loadFrame()
    page.setTitle('(3) Chat')
    expect(page.titles).toEqual([])
  })

  it('keeps the title a single-page app sets for a route it shows long after it loaded, even after a slow request', () => {
    const page = tabPage()
    page.load('https://app.example/inbox', 0, 'Inbox')
    vi.advanceTimersByTime(60_000)
    page.setTitle('(2) Inbox')
    page.changeWithinPage('https://app.example/settings', 1)
    vi.advanceTimersByTime(8_000)
    page.setTitle('Settings')
    expect(page.titles).toEqual(['Settings'])
  })
})
