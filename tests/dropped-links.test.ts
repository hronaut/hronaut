import { describe, expect, it, vi } from 'vitest'
import { orderedTabs } from '../src/main/browser/browser-core.js'
import { openDroppedLink } from '../src/main/browser/dropped-links/dropped-links.js'
import type { BrowserState } from '../src/shared/types.js'

// The browser below stubs navigate, createNewTab and getState, which a dropped link opens through and publishes with.
vi.mock('../src/main/browser/page-navigation/page-navigation.js', () => ({
  navigate: (browser: { navigate: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.navigate(...args)
}))
vi.mock('../src/main/browser/new-tabs/new-tabs.js', () => ({
  createNewTab: (browser: { createNewTab: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.createNewTab(...args)
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

const STATE = { tabs: [] } as unknown as BrowserState

type Tab = { id: string; url: string; mcpGroupId?: string; pinned: boolean }

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return { id, url: `https://example.test/${id}`, mcpGroupId: 'workspace-1', pinned: false, ...overrides }
}

/** The browser's tabs in display order, where a new tab opens last in its workspace, as createTab adds it. */
function manager(initial: Tab[], options: { beforeCreated?: (tabs: Map<string, Tab>) => void } = {}) {
  const tabs = new Map(initial.map((candidate) => [candidate.id, candidate]))
  const browser = {
    tabs,
    // The workspaces as the strip shows them.
    mcpTabGroups: new Map([['workspace-1', { id: 'workspace-1' }], ['workspace-2', { id: 'workspace-2' }]]),
    navigate: vi.fn(async (_address: string, _tabId: string, _options: { byPerson?: boolean }) => STATE),
    createNewTab: vi.fn(async (newTab: { url: string; mcpGroupId?: string }, _selectVisible: boolean, onCreated?: (created: Tab) => void) => {
      const created = tab('new', { url: newTab.url, mcpGroupId: newTab.mcpGroupId ?? 'workspace-1' })
      tabs.set(created.id, created)
      options.beforeCreated?.(tabs)
      onCreated?.(created)
      return STATE
    }),
    getState: () => STATE
  }
  return { browser, order: () => orderedTabs(browser as never).map((candidate) => candidate.id) }
}

describe('a link dropped on the tab strip or rail', () => {
  it('opens in the tab it was dropped on, as the person, without a new tab', async () => {
    const { browser } = manager([tab('first'), tab('second')])

    await expect(openDroppedLink(browser as never, 'https://example.com/dropped', { tabId: 'second', placement: 'onto' })).resolves.toBe(STATE)

    expect(browser.navigate).toHaveBeenCalledExactlyOnceWith('https://example.com/dropped', 'second', { byPerson: true })
    expect(browser.createNewTab).not.toHaveBeenCalled()
  })

  it.each([
    ['before', ['first', 'new', 'second', 'third']],
    ['after', ['first', 'second', 'new', 'third']]
  ] as const)('opens %s the tab near that edge in a new tab of its workspace', async (placement, order) => {
    const view = manager([tab('first'), tab('second'), tab('third')])

    await openDroppedLink(view.browser as never, 'https://example.com/dropped', { tabId: 'second', placement })

    expect(view.browser.createNewTab).toHaveBeenCalledExactlyOnceWith({ url: 'https://example.com/dropped', mcpGroupId: 'workspace-1' }, true, expect.any(Function))
    expect(view.browser.navigate).not.toHaveBeenCalled()
    expect(view.order()).toEqual(order)
  })

  it('opens in a new tab of the workspace the tab is in, beside it', async () => {
    const view = manager([tab('first'), tab('elsewhere', { mcpGroupId: 'workspace-2' }), tab('last', { mcpGroupId: 'workspace-2' })])

    await openDroppedLink(view.browser as never, 'https://example.com/dropped', { tabId: 'elsewhere', placement: 'after' })

    expect(view.browser.createNewTab).toHaveBeenCalledWith({ url: 'https://example.com/dropped', mcpGroupId: 'workspace-2' }, true, expect.any(Function))
    expect(view.order()).toEqual(['first', 'elsewhere', 'new', 'last'])
  })

  // As Chrome keeps a tab that is not pinned after the pinned ones.
  it.each(['before', 'after'] as const)('opens a link dropped %s a pinned tab first among the tabs that are not pinned', async (placement) => {
    const view = manager([tab('pinned-1', { pinned: true }), tab('pinned-2', { pinned: true }), tab('first'), tab('second')])

    await openDroppedLink(view.browser as never, 'https://example.com/dropped', { tabId: 'pinned-1', placement })

    expect(view.order()).toEqual(['pinned-1', 'pinned-2', 'new', 'first', 'second'])
  })

  it('leaves the new tab last in its workspace when the tab it was dropped beside closed meanwhile', async () => {
    const view = manager([tab('first'), tab('second'), tab('third')], { beforeCreated: (tabs) => { tabs.delete('second') } })

    await openDroppedLink(view.browser as never, 'https://example.com/dropped', { tabId: 'second', placement: 'before' })

    expect(view.order()).toEqual(['first', 'third', 'new'])
  })

  it('opens at the end of the workspace whose New tab button it was dropped on, or of the person\'s own', async () => {
    const view = manager([tab('first'), tab('second')])

    await openDroppedLink(view.browser as never, 'https://example.com/dropped', { workspaceId: 'workspace-1' })
    await openDroppedLink(view.browser as never, 'example.com', {})

    expect(view.browser.createNewTab).toHaveBeenNthCalledWith(1, { url: 'https://example.com/dropped', mcpGroupId: 'workspace-1' }, true)
    expect(view.browser.createNewTab).toHaveBeenNthCalledWith(2, { url: 'example.com', mcpGroupId: undefined }, true)
  })

  it('reads the text as the address bar reads a paste, so an address split over lines opens whole and words search', async () => {
    const { browser } = manager([tab('first')])

    await openDroppedLink(browser as never, '  https://example.com/a\n  /b?c=1 ', { tabId: 'first', placement: 'onto' })
    await openDroppedLink(browser as never, 'spell check\nlanguages', { tabId: 'first', placement: 'onto' })

    expect(browser.navigate).toHaveBeenNthCalledWith(1, 'https://example.com/a/b?c=1', 'first', { byPerson: true })
    // The tab manager's navigation searches for text that is no address, as for text typed in the address bar.
    expect(browser.navigate).toHaveBeenNthCalledWith(2, 'spell check languages', 'first', { byPerson: true })
  })

  // As in Chrome, which refuses a dropped javascript: address, whatever follows the scheme.
  it.each(['javascript:alert(document.cookie)', '  JavaScript:example.com', 'java\nscript:alert(1)', '\u0001javascript:alert(1)'])('opens nothing for %j', async (text) => {
    const { browser } = manager([tab('first')])

    for (const target of [{ tabId: 'first', placement: 'onto' }, { tabId: 'first', placement: 'after' }, { workspaceId: 'workspace-1' }] as const) {
      await expect(openDroppedLink(browser as never, text, target)).resolves.toBe(STATE)
    }

    expect(browser.navigate).not.toHaveBeenCalled()
    expect(browser.createNewTab).not.toHaveBeenCalled()
  })

  it('opens nothing for empty text or text longer than the longest address Chrome loads', async () => {
    const { browser } = manager([tab('first')])

    await openDroppedLink(browser as never, ' \n\t ', { tabId: 'first', placement: 'onto' })
    await openDroppedLink(browser as never, `https://example.com/${'a'.repeat(2 * 1024 * 1024)}`, { tabId: 'first', placement: 'onto' })
    await openDroppedLink(browser as never, `https://example.com/${'a'.repeat(2 * 1024 * 1024 - 20)}`, { tabId: 'first', placement: 'onto' })

    expect(browser.navigate).toHaveBeenCalledOnce()
    expect(browser.createNewTab).not.toHaveBeenCalled()
  })

  it('opens nothing on Home, and refuses a tab that is not open', async () => {
    const { browser } = manager([tab('home', { url: 'hronaut://home', mcpGroupId: undefined })])

    await expect(openDroppedLink(browser as never, 'https://example.com/', { tabId: 'home', placement: 'onto' })).resolves.toBe(STATE)
    await expect(openDroppedLink(browser as never, 'https://example.com/', { tabId: 'home', placement: 'after' })).resolves.toBe(STATE)
    await expect(openDroppedLink(browser as never, 'https://example.com/', { tabId: 'closed', placement: 'onto' })).rejects.toThrow('Tab not found: closed')

    expect(browser.navigate).not.toHaveBeenCalled()
    expect(browser.createNewTab).not.toHaveBeenCalled()
  })
})
