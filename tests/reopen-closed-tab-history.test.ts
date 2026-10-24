import { describe, expect, it } from 'vitest'
import type { NavigationEntry } from 'electron'
import type { BrowserClosedTabState } from '../src/shared/types.js'
import { forgetClosedTabs, forgetWorkspaceClosedTabs, rememberClosedTab, reopenClosedTabEntry } from '../src/main/browser/tab-reopening/tab-reopening.js'
import { withoutSleepingPage } from '../src/main/browser/tab-sleep/tab-sleep.js'
import type { TabReopeningAccess, TabReopeningCreation, TabReopeningTab } from '../src/main/browser/tab-reopening/tab-reopening-access.js'

const page = (name: string): NavigationEntry => ({ url: `https://example.test/${name}`, title: name, pageState: `state-${name}` })
/** The page a sleeping tab shows in place of its own, as tab-sleep.ts loads it. */
const SLEEPING_PAGE_URL = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ESleeping%20tab%3C%2Ftitle%3E'
const sleeping: NavigationEntry = { url: SLEEPING_PAGE_URL, title: 'Sleeping tab', pageState: '' }

/** One open tab showing the page at index of these pages, which the test closes and reopens. */
function browser(pages: string[], index: number, workspace?: string, changes: Partial<TabReopeningTab> = {}) {
  const closedTabs: BrowserClosedTabState[] = []
  const created: TabReopeningCreation[] = []
  const history = { entries: pages.map(page), index }
  const open: TabReopeningTab = {
    id: 'tab', url: history.entries[index]?.url ?? 'https://example.test/pending', title: '', pinned: false,
    zoomIsolated: false, tabMuted: false, tabAgentPaused: false, humanInteractionLocked: false,
    ...(workspace ? { mcpGroupId: workspace } : {}),
    ...changes
  }
  const access: TabReopeningAccess<TabReopeningTab> = {
    closedTabs: () => closedTabs,
    detachedClosedTabs: () => new Set(),
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
    const otherWorkspace = browser(['denied', 'b'], 1, 'client')
    otherWorkspace.close()
    forgetWorkspaceClosedTabs(otherWorkspace.access, 'other', (url) => url.endsWith('/denied'))
    expect((await otherWorkspace.reopen()).navigationHistory).toEqual({ entries: ['denied', 'b'].map(page), index: 1 })

    const tabs = browser(['denied', 'b'], 1, 'client')
    tabs.close()
    forgetWorkspaceClosedTabs(tabs.access, 'client', (url) => url.endsWith('/denied'))
    const reopened = await tabs.reopen()
    expect(reopened.navigationHistory).toEqual({ entries: [page('b')], index: 0 })
  })

  it('counts the visit of a page closed before History counted it, once it reopens', async () => {
    // The reopened page loaded as one History had counted, so its visit was never recorded.
    const tabs = browser(['a', 'b'], 1, undefined, { pendingHistoryUrl: 'https://example.test/b' })
    tabs.close()
    expect(await tabs.reopen()).toMatchObject({ navigationHistory: { entries: ['a', 'b'].map(page), index: 1 }, suppressInitialHistory: false })
    // A reopened tab closed again while its page loads was counted when it first came.
    const reopening = browser(['a', 'b'], 1, undefined, { pendingHistoryUrl: 'https://example.test/b', suppressInitialHistory: true })
    reopening.close()
    expect(await reopening.reopen()).toMatchObject({ suppressInitialHistory: true })
  })

  it('leaves out the sleeping page a waking tab keeps after its own page until that page loads', () => {
    // A tab closed while it woke came back with Forward leading to the "Sleeping tab" page.
    expect(withoutSleepingPage({ entries: [page('a'), page('b'), sleeping], index: 1 })).toEqual({ entries: [page('a'), page('b')], index: 1 })
    expect(withoutSleepingPage({ entries: [sleeping, page('a'), sleeping, page('b')], index: 3 })).toEqual({ entries: [page('a'), page('b')], index: 1 })
    // The page the tab shows stays, as that is where it is.
    expect(withoutSleepingPage({ entries: [page('a'), sleeping], index: 1 })).toEqual({ entries: [page('a'), sleeping], index: 1 })
    const plain = { entries: [page('a')], index: 0 }
    expect(withoutSleepingPage(plain)).toBe(plain)
  })
})
