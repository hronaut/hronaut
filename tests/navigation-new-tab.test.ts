import type { NavigationEntry } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { openNavigationInNewTab } from '../src/main/browser/navigation-new-tab/navigation-new-tab.js'
import type { BrowserState } from '../src/shared/types.js'

// A middle-click or Ctrl+click on Back, Forward or Reload went back, forward or reloaded in the tab itself, where Chrome
// opens that page in a new tab beside it.

type Tab = { id: string; url: string; mcpGroupId?: string }

const STATE = { tabs: [] } as unknown as BrowserState
const PAGES: NavigationEntry[] = [
  { url: 'https://shop.example/', title: 'Shop' },
  { url: 'https://shop.example/cart', title: 'Cart' },
  { url: 'https://shop.example/checkout', title: 'Checkout' }
] as NavigationEntry[]

function navigationAccess(tab: Tab, history: { entries: NavigationEntry[]; index: number } = { entries: PAGES, index: 1 }) {
  return {
    getTab: vi.fn((_tabId: string) => tab),
    navigationHistorySnapshot: vi.fn((_tab: Tab) => ({ entries: history.entries.map(entry => ({ ...entry })), index: history.index })),
    createTab: vi.fn(async (_options: Parameters<Parameters<typeof openNavigationInNewTab>[0]['createTab']>[0]) => undefined),
    getState: () => STATE
  }
}

describe('opening the page Back, Forward or Reload goes to in a new tab', () => {
  it('opens the page each goes to with the tab\'s history, beside the tab and in its workspace, behind unless asked', async () => {
    const tab = { id: 'cart', url: 'https://shop.example/cart', mcpGroupId: 'client-a' }
    const access = navigationAccess(tab)

    await expect(openNavigationInNewTab(access, 'cart', 'back', false)).resolves.toBe(STATE)
    await openNavigationInNewTab(access, 'cart', 'forward', true)
    await openNavigationInNewTab(access, 'cart', 'reload', false)

    expect(access.getTab).toHaveBeenCalledWith('cart')
    expect(access.createTab.mock.calls.map(([options]) => options)).toEqual([
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

  it('opens nothing where the tab has no page that way, for a tab with no history yet, or for Hronaut Home', async () => {
    const first = navigationAccess({ id: 'shop', url: 'https://shop.example/' }, { entries: PAGES, index: 0 })
    await expect(openNavigationInNewTab(first, 'shop', 'back', false)).resolves.toBe(STATE)
    const last = navigationAccess({ id: 'checkout', url: 'https://shop.example/checkout' }, { entries: PAGES, index: 2 })
    await openNavigationInNewTab(last, 'checkout', 'forward', false)
    const empty = navigationAccess({ id: 'new', url: 'about:blank' }, { entries: [], index: -1 })
    await openNavigationInNewTab(empty, 'new', 'reload', false)
    const home = navigationAccess({ id: 'home', url: 'hronaut://home/' }, { entries: [{ url: 'hronaut://home/', title: 'Home' } as NavigationEntry], index: 0 })
    await openNavigationInNewTab(home, 'home', 'reload', false)
    const backToHome = navigationAccess({ id: 'shop', url: 'https://shop.example/' },
      { entries: [{ url: 'hronaut://home/', title: 'Home' } as NavigationEntry, PAGES[0]!], index: 1 })
    await openNavigationInNewTab(backToHome, 'shop', 'back', false)

    for (const access of [first, last, empty, home, backToHome]) expect(access.createTab).not.toHaveBeenCalled()
  })

  it('passes on a tab that could not open, such as for a page the workspace refuses', async () => {
    const access = navigationAccess({ id: 'cart', url: 'https://shop.example/cart', mcpGroupId: 'client-a' })
    const refused = new Error('This workspace does not allow that address.')
    access.createTab.mockRejectedValueOnce(refused)
    await expect(openNavigationInNewTab(access, 'cart', 'back', false)).rejects.toBe(refused)
  })
})
