import type { NavigationEntry } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { openNavigationInNewTab } from '../src/main/browser/navigation-new-tab/navigation-new-tab.js'
import type { BrowserState } from '../src/shared/types.js'

// Finding the tab and reading the state go to the fake browser's, so the tests see which tab was asked for.
vi.mock('../src/main/browser/browser-core.js', () => ({
  getTab: (browser: { getTab: (tabId?: string) => unknown }, tabId?: string) => browser.getTab(tabId)
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

// A middle-click or Ctrl+click on Back, Forward or Reload went back, forward or reloaded in the tab itself, where Chrome
// opens that page in a new tab beside it.

type Tab = { id: string; url: string; mcpGroupId?: string; wakePromise?: Promise<void> }

const STATE = { tabs: [] } as unknown as BrowserState
const PAGES: NavigationEntry[] = [
  { url: 'https://shop.example/', title: 'Shop' },
  { url: 'https://shop.example/cart', title: 'Cart' },
  { url: 'https://shop.example/checkout', title: 'Checkout' }
] as NavigationEntry[]

function navigationBrowser(tab: Tab, history: { entries: NavigationEntry[]; index: number } = { entries: PAGES, index: 1 }) {
  const fake = {
    getTab: vi.fn((_tabId: string) => tab),
    navigationHistorySnapshot: vi.fn((_tab: Tab) => ({ entries: history.entries.map(entry => ({ ...entry })), index: history.index })),
    createTab: vi.fn(async (_options: Parameters<Browser['createTab']>[0]) => undefined),
    getState: () => STATE
  }
  return fake as typeof fake & Browser
}

describe('opening the page Back, Forward or Reload goes to in a new tab', () => {
  it('opens the page each goes to with the tab\'s history, beside the tab and in its workspace, behind unless asked', async () => {
    const tab = { id: 'cart', url: 'https://shop.example/cart', mcpGroupId: 'client-a' }
    const browser = navigationBrowser(tab)

    await expect(openNavigationInNewTab(browser, 'cart', 'back', false)).resolves.toBe(STATE)
    await openNavigationInNewTab(browser, 'cart', 'forward', true)
    await openNavigationInNewTab(browser, 'cart', 'reload', false)

    expect(browser.getTab).toHaveBeenCalledWith('cart')
    expect(browser.createTab.mock.calls.map(([options]) => options)).toEqual([
      {
        url: 'https://shop.example/', title: 'Shop', suppressInitialHistory: true, active: false,
        navigationHistory: { entries: PAGES, index: 0 }, mcpGroupId: 'client-a', openedFrom: { tabId: 'cart', background: true }
      },
      {
        url: 'https://shop.example/checkout', title: 'Checkout', suppressInitialHistory: true, active: true,
        navigationHistory: { entries: PAGES, index: 2 }, mcpGroupId: 'client-a', openedFrom: { tabId: 'cart', background: false }
      },
      {
        url: 'https://shop.example/cart', title: 'Cart', suppressInitialHistory: true, active: false,
        navigationHistory: { entries: PAGES, index: 1 }, mcpGroupId: 'client-a', openedFrom: { tabId: 'cart', background: true }
      }
    ])
  })

  it('opens nothing where the tab has no page that way, for a tab with no history yet, while a sleeping tab wakes, or for Hronaut Home', async () => {
    const first = navigationBrowser({ id: 'shop', url: 'https://shop.example/' }, { entries: PAGES, index: 0 })
    await expect(openNavigationInNewTab(first, 'shop', 'back', false)).resolves.toBe(STATE)
    const last = navigationBrowser({ id: 'checkout', url: 'https://shop.example/checkout' }, { entries: PAGES, index: 2 })
    await openNavigationInNewTab(last, 'checkout', 'forward', false)
    const empty = navigationBrowser({ id: 'new', url: 'about:blank' }, { entries: [], index: -1 })
    await openNavigationInNewTab(empty, 'new', 'reload', false)
    const home = navigationBrowser({ id: 'home', url: 'hronaut://home/' }, { entries: [{ url: 'hronaut://home/', title: 'Home' } as NavigationEntry], index: 0 })
    await openNavigationInNewTab(home, 'home', 'reload', false)
    const backToHome = navigationBrowser({ id: 'shop', url: 'https://shop.example/' },
      { entries: [{ url: 'hronaut://home/', title: 'Home' } as NavigationEntry, PAGES[0]!], index: 1 })
    await openNavigationInNewTab(backToHome, 'shop', 'back', false)

    // A waking tab's history is its placeholder page's until its own page is back.
    const waking = navigationBrowser({ id: 'cart', url: 'https://shop.example/cart', mcpGroupId: 'client-a', wakePromise: new Promise(() => undefined) },
      { entries: [...PAGES.slice(0, 2), { url: 'data:text/html,Sleeping%20tab', title: 'Sleeping tab' } as NavigationEntry], index: 2 })
    for (const target of ['back', 'reload'] as const) await openNavigationInNewTab(waking, 'cart', target, false)

    for (const browser of [first, last, empty, home, backToHome, waking]) expect(browser.createTab).not.toHaveBeenCalled()
  })

  it('passes on a tab that could not open, such as for a page the workspace refuses', async () => {
    const browser = navigationBrowser({ id: 'cart', url: 'https://shop.example/cart', mcpGroupId: 'client-a' })
    const refused = new Error('This workspace does not allow that address.')
    browser.createTab.mockRejectedValueOnce(refused)
    await expect(openNavigationInNewTab(browser, 'cart', 'back', false)).rejects.toBe(refused)
  })
})
