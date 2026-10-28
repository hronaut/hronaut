import { afterEach, expect, it, vi } from 'vitest'
import { FIRST_WAKE_WAIT_MS, putTabToSleep, sleepBeforeFirstLoad, wakeTab } from '../src/main/browser/tab-sleep/tab-sleep.js'
import { PAGE_LOAD_WAIT_MS } from '../src/main/browser/page-waits/page-load-limit.js'

// A restart loaded every restored tab at once, so 45 tabs came back as 45 pages loading together. The tabs behind the
// one shown now come back asleep and load once shown, as in Chrome; the e2e restore-tabs-asleep drives the real app.
// They first showed a sleeping page, which still started a renderer process for each of them: 45 restored tabs kept 48
// renderers running. They now load nothing until they wake.

afterEach(() => { vi.restoreAllMocks() })

const history = {
  entries: [
    { url: 'https://example.test/first', title: 'First' },
    { url: 'https://example.test/shown', title: 'Shown', pageState: 'c2Nyb2xs' },
    { url: 'https://example.test/forward', title: 'Forward' }
  ],
  index: 1
}

/**
 * A page that has not loaded, whose history and loads a test reads, and whose restored history and going back finish
 * loading at once, with Electron's events.
 */
function newPage() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  let entries: string[] = ['']
  let index = 0
  const emit = (name: string, ...args: unknown[]) => { for (const listener of [...listeners.get(name) ?? []]) listener({}, ...args) }
  const calls: string[] = []
  const webContents = {
    isDestroyed: () => false,
    isLoading: () => false,
    getURL: () => entries[index],
    loadURL: vi.fn(async (url: string) => {
      calls.push(`load ${url}`)
      entries = [...entries.slice(0, index + 1).filter(Boolean), url]
      index = entries.length - 1
    }),
    navigationHistory: {
      restore: vi.fn((restored: { entries: Array<{ url: string }>; index: number }) => {
        calls.push('restore')
        entries = restored.entries.map(entry => entry.url)
        index = restored.index
        emit('did-start-navigation', entries[index], false, true)
        emit('did-finish-load')
        return Promise.resolve()
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
  return { webContents, calls, emit, entries: () => entries, index: () => index }
}

function asleepTab(page: ReturnType<typeof newPage>, pageReady: Promise<void>, opened: { waitsForTurn?: boolean; history?: typeof history } = { history }) {
  const tab = {
    id: 'tab', url: 'https://example.test/shown', sleeping: true, loading: false, suppressInitialHistory: !opened.waitsForTurn, navigationGeneration: 0,
    lastActiveAt: 0, sleepNavigationHistory: opened.history, pageReady, webContents: page.webContents, pendingHistoryUrl: null as string | null,
    waitsForTurn: opened.waitsForTurn
  }
  const access = {
    getTab: () => tab,
    findTab: (id: string) => (id === tab.id ? tab : undefined),
    tabOverviewSleepPreviews: () => new Map(),
    firstLoadStarts: vi.fn(() => { page.calls.push('first load starts') }),
    changed: vi.fn(),
    getState: () => ({ tabs: [] })
  }
  return { tab, access, wake: () => wakeTab(access as never, tab.id) }
}

it('loads nothing in a tab created asleep until it wakes, so it starts no renderer process', async () => {
  const page = newPage()
  const { tab } = asleepTab(page, sleepBeforeFirstLoad(Promise.resolve()))
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(page.webContents.loadURL).not.toHaveBeenCalled()
  expect(page.webContents.navigationHistory.restore).not.toHaveBeenCalled()
  expect(page.entries()).toEqual([''])
  expect(tab.sleeping).toBe(true)
})

it('wakes a restored tab only once its session cookies are there, at its page with the pages around it', async () => {
  const page = newPage()
  let cookiesBack!: () => void
  const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(new Promise<void>(resolve => { cookiesBack = resolve })))
  const woken = wake()
  await new Promise(resolve => setTimeout(resolve, 10))
  // The page would otherwise load without the sign-ins its workspace keeps across a restart.
  expect(tab.sleeping).toBe(true)
  expect(page.webContents.navigationHistory.restore).not.toHaveBeenCalled()
  cookiesBack()
  await woken
  expect(page.webContents.navigationHistory.restore).toHaveBeenCalledWith(history)
  // Its page takes calls, and has its dialogs and network watched, from its first document.
  expect(page.calls).toEqual(['first load starts', 'restore'])
  expect(tab).toMatchObject({ sleeping: false, pageReady: undefined, sleepNavigationHistory: undefined })
  expect(page.entries()).toEqual(['https://example.test/first', 'https://example.test/shown', 'https://example.test/forward'])
  expect(page.index()).toBe(1)
})

it('wakes a tab without saved history at its address', async () => {
  const page = newPage()
  const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(Promise.resolve()), {})
  await wake()
  expect(page.calls).toEqual(['first load starts', `load ${tab.url}`])
  expect(page.entries()).toEqual([tab.url])
  expect(tab.sleeping).toBe(false)
})

it('wakes a tab opened to load in its turn, whose history holds only its address, as a new page at that address', async () => {
  // Restoring that history loaded the page as a history entry, which Chromium may take from its cache.
  const page = newPage()
  const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(Promise.resolve()), {
    waitsForTurn: true,
    history: { entries: [{ url: 'https://example.test/shown', title: 'Shown' }], index: 0 }
  })
  await wake()
  expect(page.calls).toEqual(['first load starts', `load ${tab.url}`])
  expect(tab.sleeping).toBe(false)
})

it('wakes a restored tab from what it holds once its session cookies are back, not from what it held before', async () => {
  const page = newPage()
  let cookiesBack!: () => void
  const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(new Promise<void>(resolve => { cookiesBack = resolve })))
  const woken = wake()
  // Clearing the browsing data takes the shown page out of the history the tab sleeps with meanwhile.
  const cleared = { entries: [{ url: 'https://example.test/first', title: 'First', pageState: 'c2Nyb2xs' }], index: 0 }
  tab.url = 'https://example.test/first'
  tab.sleepNavigationHistory = cleared
  cookiesBack()
  await woken
  expect(page.webContents.navigationHistory.restore).toHaveBeenLastCalledWith(cleared)
  expect(page.entries()).toEqual(['https://example.test/first'])
})

it('loads the address alone when Electron refuses the history', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const page = newPage()
  page.webContents.navigationHistory.restore.mockImplementationOnce(() => {
    page.calls.push('restore')
    throw new Error('Invalid history')
  })
  const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(Promise.resolve()))
  await wake()
  expect(page.calls).toEqual(['first load starts', 'restore', `load ${tab.url}`])
  expect(tab.sleeping).toBe(false)
  expect(warn).toHaveBeenCalledWith('[browser] Could not restore the history of a tab created asleep:', expect.any(Error))
})

it('leaves the first load that a newer navigation replaced to that navigation, also when that one fails', async () => {
  // Electron settles a restored history only once a page finishes or fails loading: the wake waited for the newer
  // navigation's page, and its failure loaded the tab's address over it.
  const page = newPage()
  const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(Promise.resolve()))
  page.webContents.navigationHistory.restore.mockImplementationOnce(() => {
    page.emit('did-start-navigation', 'https://example.test/shown', false, true)
    // An agent loads another address before the restored page committed, which the site refuses.
    tab.navigationGeneration += 1
    page.webContents.isLoading = () => true
    page.emit('did-start-navigation', 'https://other.example/', false, true)
    page.emit('did-fail-load', -105, 'ERR_NAME_NOT_RESOLVED', 'https://other.example/', true)
    return new Promise(() => undefined)
  })
  await wake()
  expect(page.webContents.loadURL).not.toHaveBeenCalled()
  expect(tab.sleeping).toBe(false)
})

it('ends the wake of a tab closed while its first page loads, without loading it again', async () => {
  const page = newPage()
  const { wake } = asleepTab(page, sleepBeforeFirstLoad(Promise.resolve()))
  page.webContents.navigationHistory.restore.mockImplementationOnce(() => {
    page.calls.push('restore')
    page.emit('did-start-navigation', 'https://example.test/shown', false, true)
    page.webContents.isDestroyed = () => true
    page.emit('destroyed')
    return new Promise(() => undefined)
  })
  await wake()
  expect(page.calls).toEqual(['first load starts', 'restore'])
})

it('loads the address again when the restored page stops loading without finishing', async () => {
  const page = newPage()
  const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(Promise.resolve()))
  page.webContents.navigationHistory.restore.mockImplementationOnce(() => {
    page.calls.push('restore')
    page.emit('did-start-navigation', 'https://example.test/shown', false, true)
    page.emit('did-stop-loading')
    return new Promise(() => undefined)
  })
  await wake()
  expect(page.calls).toEqual(['first load starts', 'restore', `load ${tab.url}`])
  expect(tab.sleeping).toBe(false)
})

it('wakes a restored tab whose session cookies never come back after a while', async () => {
  vi.useFakeTimers()
  try {
    const page = newPage()
    const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(new Promise<void>(() => undefined)))
    const woken = wake()
    await vi.advanceTimersByTimeAsync(FIRST_WAKE_WAIT_MS - 1)
    expect(page.webContents.navigationHistory.restore).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await woken
    expect(tab.sleeping).toBe(false)
    expect(page.webContents.navigationHistory.restore).toHaveBeenCalledWith(history)
  } finally {
    vi.useRealTimers()
  }
})

it('records the first load of a tab opened to load in its turn as a visit, and a restored tab\'s load again as none', async () => {
  // Open all's pages loaded at once were visits; loading them in their turn left them out of History.
  const opened = newPage()
  const { tab: openedTab, wake: wakeOpened } = asleepTab(opened, sleepBeforeFirstLoad(Promise.resolve()), { waitsForTurn: true })
  await wakeOpened()
  expect(openedTab).toMatchObject({ sleeping: false, suppressInitialHistory: false, waitsForTurn: false })
  const restored = newPage()
  const { tab: restoredTab, wake: wakeRestored } = asleepTab(restored, sleepBeforeFirstLoad(Promise.resolve()), {})
  await wakeRestored()
  expect(restoredTab).toMatchObject({ sleeping: false, suppressInitialHistory: true })
})

it('keeps the visit of a tab loading in its turn whose page goes on loading after the wait', async () => {
  vi.useFakeTimers()
  try {
    for (const waitsForTurn of [true, false]) {
      const page = newPage()
      const { tab, wake } = asleepTab(page, sleepBeforeFirstLoad(Promise.resolve()), { waitsForTurn })
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
