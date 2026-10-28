import { afterEach, expect, it, vi } from 'vitest'
import { putTabToSleep, SLEEPING_PAGE_WAIT_MS, sleepBeforeFirstLoad, wakeTab } from '../src/main/browser/tab-sleep/tab-sleep.js'
import { PAGE_LOAD_WAIT_MS } from '../src/main/browser/page-waits/page-load-limit.js'
import { SLEEPING_PAGE_URL } from '../src/main/browser/tab-sleep/sleeping-page.js'

// A restart loaded every restored tab at once, so 45 tabs came back as 45 pages loading together. The tabs behind the
// one shown now come back asleep and load once shown, as in Chrome; the e2e restore-tabs-asleep drives the real app.

afterEach(() => { vi.restoreAllMocks() })

const history = {
  entries: [
    { url: 'https://example.test/first', title: 'First' },
    { url: 'https://example.test/shown', title: 'Shown', pageState: 'c2Nyb2xs' },
    { url: 'https://example.test/forward', title: 'Forward' }
  ],
  index: 1
}

/** A page that has not loaded, whose history and loads a test reads, and whose going back finishes loading at once. */
function newPage() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  let entries: string[] = ['']
  let index = 0
  const emit = (name: string, ...args: unknown[]) => { for (const listener of [...listeners.get(name) ?? []]) listener({}, ...args) }
  const webContents = {
    isDestroyed: () => false,
    isLoading: () => false,
    getURL: () => entries[index],
    loadURL: vi.fn(async (url: string) => { entries = [...entries.slice(0, index + 1).filter(Boolean), url]; index = entries.length - 1 }),
    navigationHistory: {
      restore: vi.fn(async (restored: { entries: Array<{ url: string }>; index: number }) => {
        entries = restored.entries.map(entry => entry.url)
        index = restored.index
      }),
      length: () => entries.length,
      getActiveIndex: () => index,
      getEntryAtIndex: (at: number) => (at in entries ? { url: entries[at] } : null),
      goToIndex: vi.fn((at: number) => {
        index = at
        emit('did-start-navigation', entries[at], false, true)
        emit('did-finish-load')
      }),
      removeEntryAtIndex: (at: number) => {
        entries.splice(at, 1)
        if (at < index) index -= 1
      }
    },
    on: (name: string, listener: (...args: unknown[]) => void) => { listeners.set(name, [...listeners.get(name) ?? [], listener]) },
    once: vi.fn(),
    removeListener: (name: string, listener: (...args: unknown[]) => void) => { listeners.set(name, (listeners.get(name) ?? []).filter(other => other !== listener)) }
  }
  return { webContents, entries: () => entries, index: () => index }
}

function asleepTab(page: ReturnType<typeof newPage>, pageReady: Promise<void>, opened: { waitsForTurn?: boolean } = {}) {
  const tab = {
    id: 'tab', url: 'https://example.test/shown', sleeping: true, loading: false, suppressInitialHistory: !opened.waitsForTurn, navigationGeneration: 0,
    lastActiveAt: 0, sleepNavigationHistory: history, pageReady, webContents: page.webContents, pendingHistoryUrl: null as string | null,
    waitsForTurn: opened.waitsForTurn
  }
  const access = {
    getTab: () => tab,
    findTab: (id: string) => (id === tab.id ? tab : undefined),
    tabOverviewSleepPreviews: () => new Map(),
    changed: vi.fn(),
    getState: () => ({ tabs: [] })
  }
  return { tab, wake: () => wakeTab(access as never, tab.id) }
}

it('puts the sleeping page right after the page a restored tab shows, keeping the pages before and after it', async () => {
  const page = newPage()
  await sleepBeforeFirstLoad(page.webContents as never, history, Promise.resolve())
  expect(page.webContents.navigationHistory.restore).toHaveBeenCalledWith({
    entries: [history.entries[0], history.entries[1], { url: SLEEPING_PAGE_URL, title: '' }, history.entries[2]],
    index: 2
  })
  expect(page.webContents.loadURL).not.toHaveBeenCalled()
})

it('shows only the sleeping page in a tab without saved history, and when Electron cannot take the history', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const plain = newPage()
  await sleepBeforeFirstLoad(plain.webContents as never, undefined, Promise.resolve())
  expect(plain.webContents.loadURL).toHaveBeenCalledWith(SLEEPING_PAGE_URL)
  const refused = newPage()
  refused.webContents.navigationHistory.restore.mockRejectedValueOnce(new Error('Invalid history'))
  await sleepBeforeFirstLoad(refused.webContents as never, history, Promise.resolve())
  expect(refused.webContents.loadURL).toHaveBeenCalledWith(SLEEPING_PAGE_URL)
  expect(warn).toHaveBeenCalledWith('[browser] Could not restore the history of a tab created asleep:', expect.any(Error))
})

it('wakes a restored tab only once its sleeping page and session cookies are there, at its page with the pages around it', async () => {
  const page = newPage()
  let cookiesBack!: () => void
  const pageReady = sleepBeforeFirstLoad(page.webContents as never, history, new Promise<void>(resolve => { cookiesBack = resolve }))
  const { tab, wake } = asleepTab(page, pageReady)
  const woken = wake()
  await new Promise(resolve => setTimeout(resolve, 10))
  // The page would otherwise load without the sign-ins its workspace keeps across a restart.
  expect(tab.sleeping).toBe(true)
  expect(page.webContents.navigationHistory.goToIndex).not.toHaveBeenCalled()
  cookiesBack()
  await woken
  expect(page.webContents.navigationHistory.goToIndex).toHaveBeenCalledWith(1)
  expect(tab).toMatchObject({ sleeping: false, pageReady: undefined, sleepNavigationHistory: undefined })
  expect(page.entries()).toEqual(['https://example.test/first', 'https://example.test/shown', 'https://example.test/forward'])
  expect(page.index()).toBe(1)
})

it('wakes a tab without saved history at its address', async () => {
  const page = newPage()
  const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(page.webContents as never, undefined, Promise.resolve()))
  await wake()
  expect(page.webContents.loadURL).toHaveBeenLastCalledWith(tab.url)
  expect(page.entries()).toEqual([tab.url])
  expect(tab.sleeping).toBe(false)
})

it('wakes a restored tab from what it holds once its sleeping page is there, not from what it held before', async () => {
  const page = newPage()
  let cookiesBack!: () => void
  const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(page.webContents as never, history, new Promise<void>(resolve => { cookiesBack = resolve })))
  const woken = wake()
  // Clearing the browsing data takes the shown page out of the history the tab sleeps with meanwhile.
  tab.url = 'https://example.test/first'
  tab.sleepNavigationHistory = { entries: [{ url: 'https://example.test/first', title: 'First' }], index: 0 }
  cookiesBack()
  await woken
  expect(page.webContents.loadURL).toHaveBeenLastCalledWith('https://example.test/first')
  expect(page.webContents.navigationHistory.goToIndex).not.toHaveBeenCalled()
})

it('shows the sleeping page when Electron throws on the history instead of refusing it', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const page = newPage()
  page.webContents.navigationHistory.restore.mockImplementationOnce(() => { throw new Error('Invalid history') })
  await sleepBeforeFirstLoad(page.webContents as never, history, Promise.resolve())
  expect(page.webContents.loadURL).toHaveBeenCalledWith(SLEEPING_PAGE_URL)
  expect(warn).toHaveBeenCalledOnce()
})

it('wakes a restored tab whose sleeping page never finishes after a while, and keeps that page from replacing its own', async () => {
  vi.useFakeTimers()
  try {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const page = newPage()
    let refuse!: (error: Error) => void
    page.webContents.navigationHistory.restore.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { refuse = reject }))
    const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(page.webContents as never, history, Promise.resolve()))
    const woken = wake()
    await vi.advanceTimersByTimeAsync(SLEEPING_PAGE_WAIT_MS)
    await woken
    expect(tab.sleeping).toBe(false)
    expect(page.webContents.loadURL).toHaveBeenLastCalledWith(tab.url)
    // The history Electron could not take fails only now, after the tab woke.
    refuse(new Error('Renderer gone'))
    await vi.advanceTimersByTimeAsync(0)
    expect(page.webContents.loadURL).not.toHaveBeenCalledWith(SLEEPING_PAGE_URL)
  } finally {
    vi.useRealTimers()
  }
})

it('records the first load of a tab opened to load in its turn as a visit, and a restored tab\'s load again as none', async () => {
  // Open all's pages loaded at once were visits; loading them in their turn left them out of History.
  const opened = newPage()
  const { tab: openedTab, wake: wakeOpened } = asleepTab(opened, sleepBeforeFirstLoad(opened.webContents as never, undefined, Promise.resolve()), { waitsForTurn: true })
  await wakeOpened()
  expect(openedTab).toMatchObject({ sleeping: false, suppressInitialHistory: false, waitsForTurn: false })
  const restored = newPage()
  const { tab: restoredTab, wake: wakeRestored } = asleepTab(restored, sleepBeforeFirstLoad(restored.webContents as never, undefined, Promise.resolve()))
  await wakeRestored()
  expect(restoredTab).toMatchObject({ sleeping: false, suppressInitialHistory: true })
})

it('keeps the visit of a tab loading in its turn whose page goes on loading after the wait', async () => {
  vi.useFakeTimers()
  try {
    for (const waitsForTurn of [true, false]) {
      const page = newPage()
      const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(page.webContents as never, undefined, Promise.resolve()), { waitsForTurn })
      await vi.advanceTimersByTimeAsync(0)
      const load = page.webContents.loadURL.getMockImplementation()!
      // The page commits, which makes its address the visit waiting for its load to end, and its image never comes.
      page.webContents.loadURL.mockImplementationOnce(async (url: string) => {
        await load(url)
        tab.pendingHistoryUrl = url
        await new Promise(() => undefined)
      })
      const woken = wake()
      await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
      await woken
      expect(tab).toMatchObject({ sleeping: false, suppressInitialHistory: false, pendingHistoryUrl: waitsForTurn ? tab.url : null })
    }
  } finally {
    vi.useRealTimers()
  }
})

it('keeps a tab waiting for its turn asleep once it is put to sleep', async () => {
  const page = newPage()
  const { tab } = asleepTab(page, Promise.resolve(), { waitsForTurn: true })
  expect(await putTabToSleep({} as never, tab as never, true)).toBe(false)
  expect(tab).toMatchObject({ sleeping: true, waitsForTurn: false })
})
