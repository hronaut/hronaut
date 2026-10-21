import { describe, expect, it, vi } from 'vitest'
import { wakeTab } from '../src/main/browser/tab-sleep/tab-sleep.js'

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
    isDestroyed: () => false,
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
  const access = {
    getTab: () => tab,
    findTab: (id: string) => (id === tab.id ? tab : undefined),
    tabOverviewSleepPreviews: () => new Map(),
    changed: vi.fn(),
    getState: () => ({ tabs: [] })
  }
  return { tab, entries, wake: () => wakeTab(access as never, tab.id) }
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
