import { describe, expect, it, vi } from 'vitest'
import { wakeTab } from '../src/main/browser/tab-sleep/tab-sleep.js'

// The sleeping tab's browser below stubs changed and getState, which waking publishes through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

// A sleeping tab whose website could not be reached could not be opened: the wake failed and sent it back to sleep,
// though Chromium already showed the error page at its address. The e2e wake-unreachable-site drives the real app.

const SLEEPING_PAGE_URL = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ESleeping%20tab%3C%2Ftitle%3E'
const ADDRESS = 'http://127.0.0.1:3000/app'

/**
 * A sleeping tab on the address, whose going back throws and whose loads fail with a refused connection. Each failed
 * load commits the page `commits` names, as Chromium commits an error page, or commits nothing when it is null.
 */
function sleepingTab(commits: string | null) {
  const entries = [ADDRESS, SLEEPING_PAGE_URL]
  let index = 1
  const webContents = {
    isDestroyed: (): boolean => false,
    isLoading: () => false,
    getURL: () => entries[index],
    loadURL: vi.fn(async (url: string) => {
      if (commits !== null) {
        entries.splice(index + 1, entries.length, commits)
        index += 1
      }
      throw Object.assign(new Error(`ERR_CONNECTION_REFUSED (-102) loading '${url}'`), { errno: -102, code: 'ERR_CONNECTION_REFUSED', url })
    }),
    navigationHistory: {
      length: () => entries.length,
      getActiveIndex: () => index,
      getEntryAtIndex: (at: number) => (at in entries ? { url: entries[at] } : undefined),
      goToIndex: () => { throw new Error('Going back failed') },
      removeEntryAtIndex: (at: number) => {
        entries.splice(at, 1)
        if (at < index) index -= 1
      }
    },
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn()
  }
  const tab = {
    id: 'tab', url: ADDRESS, sleeping: true, loading: false, suppressInitialHistory: false, navigationGeneration: 3,
    lastActiveAt: 0, sleepNavigationHistory: { entries: [], index: 0 }, webContents
  }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    tabOverviewSleepPreviews: new Map(),
    changed: vi.fn(),
    getState: () => ({ tabs: [] })
  }
  return { tab, entries, wake: () => wakeTab(browser as never, tab.id) }
}

describe('waking a sleeping tab whose website cannot be reached', () => {
  it('leaves the tab awake on the error page at its address, without the sleeping page in its history', async () => {
    const { tab, entries, wake } = sleepingTab(ADDRESS)
    await expect(wake()).resolves.toBeDefined()
    expect(tab.sleeping).toBe(false)
    expect(entries).toEqual([ADDRESS, ADDRESS])
  })

  it('leaves the tab awake on the error page of the address it redirected to', async () => {
    const { tab, entries, wake } = sleepingTab('http://127.0.0.1:3001/sign-in')
    await expect(wake()).resolves.toBeDefined()
    expect(tab.sleeping).toBe(false)
    expect(entries).toEqual([ADDRESS, 'http://127.0.0.1:3001/sign-in'])
  })

  it('still sends the tab back to sleep and reports the failure when no page committed', async () => {
    const { tab, entries, wake } = sleepingTab(null)
    await expect(wake()).rejects.toMatchObject({ message: expect.stringContaining('ERR_CONNECTION_REFUSED') })
    expect(tab.sleeping).toBe(true)
    expect(tab.sleepNavigationHistory).toEqual({ entries: [], index: 0 })
    expect(entries).toEqual([ADDRESS, SLEEPING_PAGE_URL])
  })
})

describe('waking a sleeping tab whose page Electron destroys meanwhile', () => {
  // The fallback load then called the destroyed page and threw Electron's English "Object has been destroyed", and the
  // tab went back to sleep over the row that says its page is gone.
  it('ends the wake, loading nothing more, and leaves the tab awake to say its page is gone', async () => {
    const { tab, wake } = sleepingTab(null)
    let destroyed = false
    tab.webContents.isDestroyed = () => destroyed
    tab.webContents.navigationHistory.goToIndex = () => {
      destroyed = true
      throw Object.assign(new Error('ERR_FAILED (-2)'), { errno: -2, code: 'ERR_FAILED' })
    }
    await expect(wake()).resolves.toBeDefined()
    expect(tab.webContents.loadURL).not.toHaveBeenCalled()
    expect(tab.sleeping).toBe(false)
  })

  it('ends the wake when the page is destroyed as the address loads again, and when it was destroyed already', async () => {
    const failing = sleepingTab(null)
    let destroyed = false
    failing.tab.webContents.isDestroyed = () => destroyed
    failing.tab.webContents.loadURL.mockImplementation(async () => {
      destroyed = true
      throw Object.assign(new Error('ERR_FAILED (-2)'), { errno: -2, code: 'ERR_FAILED' })
    })
    await expect(failing.wake()).resolves.toBeDefined()
    expect(failing.tab.sleeping).toBe(false)

    const gone = sleepingTab(null)
    gone.tab.webContents.isDestroyed = () => true
    await expect(gone.wake()).resolves.toBeDefined()
    expect(gone.tab.sleeping).toBe(true)
    expect(gone.tab.loading).toBe(false)
  })
})
