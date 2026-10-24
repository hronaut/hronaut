import { describe, expect, it } from 'vitest'
import type { NavigationEntry } from 'electron'
import type { BrowserClosedTabState } from '../src/shared/types.js'
import { forgetClosedTabs, forgetWorkspaceClosedTabs, rememberClosedTab, reopenClosedTabEntry } from '../src/main/browser/tab-reopening/tab-reopening.js'
import type { TabReopeningAccess, TabReopeningCreation, TabReopeningTab } from '../src/main/browser/tab-reopening/tab-reopening-access.js'

const page = (name: string): NavigationEntry => ({ url: `https://example.test/${name}`, title: name, pageState: `state-${name}` })

/** One open tab showing the page at index of these pages, which the test closes and reopens. */
function browser(pages: string[], index: number, workspace?: string) {
  const closedTabs: BrowserClosedTabState[] = []
  const closedTabHistories = new WeakMap()
  const created: TabReopeningCreation[] = []
  const history = { entries: pages.map(page), index }
  const open: TabReopeningTab = {
    id: 'tab', url: history.entries[index]?.url ?? 'https://example.test/pending', title: '', pinned: false,
    zoomIsolated: false, tabMuted: false, tabAgentPaused: false, humanInteractionLocked: false,
    ...(workspace ? { mcpGroupId: workspace } : {})
  }
  const access: TabReopeningAccess<TabReopeningTab> = {
    closedTabs: () => closedTabs,
    detachedClosedTabs: () => new Set(),
    closedTabHistories: () => closedTabHistories,
    tabCount: () => 0,
    orderedTabs: () => [],
    getTab: () => open,
    navigationHistorySnapshot: () => history,
    createTab: async (options) => {
      created.push(options)
      return { ...open, id: `reopened-${created.length}` }
    },
    reorderTab: () => ({}) as never,
    getState: () => ({}) as never
  }
  return {
    access,
    closedTabs,
    history,
    close: () => rememberClosedTab(access, open),
    reopen: async () => {
      await reopenClosedTabEntry(access, undefined, true)
      return created.at(-1)!
    }
  }
}

describe('reopening a closed tab with its history', () => {
  // It came back at its page alone, with no Back or Forward, its scroll and form state gone, and counted another visit.
  it('restores its back and forward pages and the page it showed, without counting another visit', async () => {
    const tabs = browser(['a', 'b', 'c'], 1)
    tabs.close()
    // The browser state publishes the closed tabs; the pages' saved state stays out of them.
    expect(JSON.stringify(tabs.closedTabs)).not.toContain('state-')

    const reopened = await tabs.reopen()
    expect(reopened).toMatchObject({
      url: 'https://example.test/b',
      suppressInitialHistory: true,
      navigationHistory: { entries: ['a', 'b', 'c'].map(page), index: 1 }
    })
  })

  it('keeps six pages on each side of the page it showed', async () => {
    const names = Array.from({ length: 20 }, (_, index) => `p${index}`)
    const tabs = browser(names, 10)
    tabs.close()
    const reopened = await tabs.reopen()
    expect(reopened.navigationHistory).toEqual({ entries: names.slice(4, 17).map(page), index: 6 })
  })

  it('keeps the history as it was when the tab closed, whatever changes the history it came from', async () => {
    const tabs = browser(['a', 'b'], 1)
    tabs.close()
    tabs.history.entries[0]!.url = 'https://example.test/changed'
    const reopened = await tabs.reopen()
    expect(reopened.navigationHistory!.entries[0]).toEqual(page('a'))
  })

  it('keeps the history taken before its page went away, as a page that lets its tab close is gone once it answers', async () => {
    const tabs = browser(['a', 'b'], 1)
    const taken = { entries: tabs.history.entries.map((entry) => ({ ...entry })), index: 1 }
    tabs.history.entries.splice(0)
    tabs.history.index = -1
    rememberClosedTab(tabs.access, tabs.access.getTab(), taken)
    const reopened = await tabs.reopen()
    expect(reopened.navigationHistory).toEqual({ entries: ['a', 'b'].map(page), index: 1 })
  })

  it('opens a tab closed before its first page came at its address, as a visit', async () => {
    const tabs = browser([], -1)
    tabs.close()
    const reopened = await tabs.reopen()
    expect(reopened.url).toBe('https://example.test/pending')
    expect(reopened.navigationHistory).toBeUndefined()
    expect(reopened.suppressInitialHistory).toBeUndefined()
  })

  it('forgets the back and forward pages whose history was cleared, keeping the page it showed', async () => {
    const tabs = browser(['a', 'b', 'c', 'd'], 2)
    tabs.close()
    expect(forgetClosedTabs(tabs.access, (url) => url.endsWith('/a') || url.endsWith('/d'))).toBe(false)
    expect(tabs.closedTabs).toHaveLength(1)
    const reopened = await tabs.reopen()
    expect(reopened.navigationHistory).toEqual({ entries: ['b', 'c'].map(page), index: 1 })
  })

  it('forgets the pages a workspace\'s Site access now denies from its closed tabs\' history', async () => {
    const tabs = browser(['denied', 'b'], 1, 'client')
    tabs.close()
    forgetWorkspaceClosedTabs(tabs.access, 'other', (url) => url.endsWith('/denied'))
    forgetWorkspaceClosedTabs(tabs.access, 'client', (url) => url.endsWith('/denied'))
    const reopened = await tabs.reopen()
    expect(reopened.navigationHistory).toEqual({ entries: [page('b')], index: 0 })
  })
})
