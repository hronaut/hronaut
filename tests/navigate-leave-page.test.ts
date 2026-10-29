import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { navigate } from '../src/main/browser/page-navigation/page-navigation.js'

// The browser below stubs getState, which navigating publishes through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

// A page that asks before it is left kept itself open when an address was loaded in its tab: Electron cancels the load
// as an abort, which navigate swallowed, so the address bar did nothing and browser_navigate reported success.

function pageThatAsksToStay(confirmLeavePage: () => Promise<boolean> = async () => false) {
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isCrashed: () => false,
    // As Electron: the page's question goes to will-prevent-unload, and the load is cancelled unless it is prevented.
    loadURL: vi.fn(async function (this: EventEmitter) {
      let left = false
      webContents.emit('will-prevent-unload', { preventDefault: () => { left = true } })
      if (!left) throw Object.assign(new Error('ERR_ABORTED (-3) loading'), { code: 'ERR_ABORTED', errno: -3 })
    })
  })
  const tab = { id: 'tab', navigationGeneration: 0, documentGeneration: 0, navigationPolicyDenialSequence: 0, sleeping: false, webContents }
  const tabs = new Map([[tab.id, tab]])
  const browser = {
    tabs,
    // The tab is behind the one shown, so asking about its page brings it into view first.
    activeTabId: 'shown',
    options: { confirmBeforeUnloadLeave: vi.fn(confirmLeavePage) },
    prepareDiagnosticNavigation: vi.fn(),
    selectTabForPerson: vi.fn(async (_tabId: string) => undefined),
    focusPageAfterQuestion: vi.fn(),
    getState: () => ({ ok: true })
  }
  return { tab, tabs, webContents, browser, go: (byPerson?: boolean) => navigate(browser as never, 'https://next.example/', tab.id, { byPerson }) }
}

describe('loading an address from a page that asks before it is left', () => {
  it('tells an agent the page stayed open', async () => {
    const { go, browser, webContents } = pageThatAsksToStay()
    await expect(go()).rejects.toThrow('The page asked to confirm before it is left (a beforeunload prompt, as a page with unsaved changes shows), so it stayed open and nothing was loaded. To open the address anyway, use browser_new_tab.')
    expect(browser.options.confirmBeforeUnloadLeave).not.toHaveBeenCalled()
    expect(webContents.listenerCount('will-prevent-unload')).toBe(0)
  })

  it('asks a person and keeps the page when they keep editing', async () => {
    const { go, browser, tab, webContents } = pageThatAsksToStay(async () => false)
    await expect(go(true)).resolves.toEqual({ ok: true })
    expect(browser.options.confirmBeforeUnloadLeave).toHaveBeenCalledOnce()
    expect(webContents.loadURL).toHaveBeenCalledOnce()
    // The address bar gave up the keyboard on Enter, which left it nowhere once the question closed.
    expect(browser.focusPageAfterQuestion).toHaveBeenCalledExactlyOnceWith(tab.webContents)
  })

  // A link dropped on a tab behind the one shown asked about a page the person could not see.
  it('brings the tab into view before asking the person, and asks nothing once its page went elsewhere meanwhile', async () => {
    const { go, browser, tab } = pageThatAsksToStay(async () => true)
    const order: string[] = []
    browser.selectTabForPerson.mockImplementation(async () => { order.push('shown') })
    browser.options.confirmBeforeUnloadLeave.mockImplementation(async () => { order.push('asked'); return true })
    await go(true)
    expect(browser.selectTabForPerson).toHaveBeenCalledExactlyOnceWith(tab.id)
    expect(order).toEqual(['shown', 'asked'])

    const moved = pageThatAsksToStay(async () => true)
    moved.browser.selectTabForPerson.mockImplementation(async () => { moved.tab.documentGeneration++ })
    await moved.go(true)
    expect(moved.browser.options.confirmBeforeUnloadLeave).not.toHaveBeenCalled()
    expect(moved.webContents.loadURL).toHaveBeenCalledOnce()
  })

  it('gives no keyboard to a page that went elsewhere while the person decided to stay', async () => {
    const { go, browser, tab } = pageThatAsksToStay(async () => { tab.documentGeneration++; return false })
    await go(true)
    expect(browser.focusPageAfterQuestion).not.toHaveBeenCalled()
  })

  it('loads the address once a person chooses to leave, without asking again', async () => {
    const { go, browser, webContents } = pageThatAsksToStay(async () => true)
    await expect(go(true)).resolves.toEqual({ ok: true })
    expect(browser.options.confirmBeforeUnloadLeave).toHaveBeenCalledOnce()
    expect(browser.focusPageAfterQuestion).not.toHaveBeenCalled()
    expect(webContents.loadURL).toHaveBeenCalledTimes(2)
    expect(webContents.listenerCount('will-prevent-unload')).toBe(0)
  })

  it('loads nothing when the page went elsewhere while the person was asked', async () => {
    const { go, tab, webContents } = pageThatAsksToStay(async () => { tab.navigationGeneration++; tab.documentGeneration++; return true })
    await go(true)
    expect(webContents.loadURL).toHaveBeenCalledOnce()
  })

  it('still leaves when the page changed its address within itself while the person was asked, as an autosave does', async () => {
    const { go, tab, webContents } = pageThatAsksToStay(async () => { tab.navigationGeneration++; return true })
    await go(true)
    expect(webContents.loadURL).toHaveBeenCalledTimes(2)
  })

  it('loads nothing when the tab closed while the person was asked', async () => {
    const { go, tabs, webContents } = pageThatAsksToStay(async () => { tabs.clear(); return true })
    await go(true)
    expect(webContents.loadURL).toHaveBeenCalledOnce()
  })

  it('does not ask when another page started in the tab while the load was stopped', async () => {
    const { go, tab, browser, webContents } = pageThatAsksToStay(async () => true)
    webContents.loadURL.mockImplementationOnce(async () => {
      webContents.emit('will-prevent-unload', { preventDefault: () => undefined })
      tab.documentGeneration++
      throw Object.assign(new Error('ERR_ABORTED (-3) loading'), { code: 'ERR_ABORTED' })
    })
    await go(true)
    expect(browser.options.confirmBeforeUnloadLeave).not.toHaveBeenCalled()
    expect(webContents.loadURL).toHaveBeenCalledOnce()
  })

  it('answers only the question of the page being left, not one the new page asks while it loads', async () => {
    const { go, webContents } = pageThatAsksToStay(async () => true)
    const laterQuestion = vi.fn()
    webContents.loadURL.mockImplementationOnce(async () => {
      webContents.emit('will-prevent-unload', { preventDefault: () => undefined })
      throw Object.assign(new Error('ERR_ABORTED (-3) loading'), { code: 'ERR_ABORTED' })
    }).mockImplementationOnce(async () => {
      webContents.emit('did-start-navigation', {}, 'https://next.example/', false, true)
      webContents.emit('will-prevent-unload', { preventDefault: laterQuestion })
    })
    await go(true)
    expect(laterQuestion).not.toHaveBeenCalled()
    expect(webContents.listenerCount('did-start-navigation')).toBe(0)
  })

  it('tells an agent the page stayed open whatever error the stopped load reports', async () => {
    const { go, webContents } = pageThatAsksToStay()
    webContents.loadURL.mockImplementationOnce(async () => {
      webContents.emit('will-prevent-unload', { preventDefault: () => undefined })
      throw Object.assign(new Error('ERR_FAILED (-2) loading'), { code: 'ERR_FAILED', errno: -2 })
    })
    await expect(go()).rejects.toThrow('so it stayed open and nothing was loaded')
  })

  it('keeps an abort that the page did not ask for silent', async () => {
    const { go, browser, webContents } = pageThatAsksToStay()
    webContents.loadURL.mockImplementationOnce(async () => { throw Object.assign(new Error('ERR_ABORTED (-3) loading'), { code: 'ERR_ABORTED' }) })
    await expect(go()).resolves.toEqual({ ok: true })
    expect(browser.options.confirmBeforeUnloadLeave).not.toHaveBeenCalled()
  })
})
