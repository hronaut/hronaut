import { describe, expect, it } from 'vitest'
import type { BrowserClosedTabState } from '../src/shared/types.js'
import { rememberClosedTab, reopenClosedTabEntry } from '../src/main/browser/tab-reopening/tab-reopening.js'
import type { TabReopeningAccess, TabReopeningCreation, TabReopeningTab } from '../src/main/browser/tab-reopening/tab-reopening-access.js'

/**
 * Open tabs in strip order, as the tab manager keeps them: tabs outside a workspace first, pinned tabs first within
 * each, and a new tab last among its peers. Closing remembers the tab while it is still open and then removes it, and
 * reordering moves a tab before or after another.
 */
function strip(tabs: { title: string; pinned?: boolean; workspace?: string }[]) {
  let created = 0
  const open: TabReopeningTab[] = tabs.map(({ title, pinned = false, workspace }) => tab(title, pinned, workspace))
  const closedTabs: BrowserClosedTabState[] = []
  function tab(title: string, pinned: boolean, workspace?: string): TabReopeningTab {
    created += 1
    return {
      id: `tab-${created}`, url: `https://example.test/${title}`, title, pinned, zoomIsolated: false, tabMuted: false,
      tabAgentPaused: false, humanInteractionLocked: false, ...(workspace ? { mcpGroupId: workspace } : {})
    }
  }
  function orderedTabs(): TabReopeningTab[] {
    return [...open].sort((first, second) => (
      Number(first.mcpGroupId !== undefined) - Number(second.mcpGroupId !== undefined) || Number(second.pinned) - Number(first.pinned)
    ))
  }
  const access: TabReopeningAccess<TabReopeningTab> = {
    closedTabs: () => closedTabs,
    detachedClosedTabs: () => new Set(),
    tabCount: () => open.length,
    orderedTabs,
    getTab: (tabId) => open.find((candidate) => candidate.id === tabId)!,
    navigationHistorySnapshot: () => ({ entries: [], index: 0 }),
    createTab: async (options: TabReopeningCreation) => {
      const reopened = tab(options.url.split('/').at(-1)!, options.pinned === true, options.mcpGroupId)
      open.push(reopened)
      return reopened
    },
    reorderTab: (tabId, targetTabId, placement) => {
      const ordered = orderedTabs()
      const moved = ordered.splice(ordered.findIndex((candidate) => candidate.id === tabId), 1)[0]!
      ordered.splice(ordered.findIndex((candidate) => candidate.id === targetTabId) + (placement === 'after' ? 1 : 0), 0, moved)
      open.splice(0, open.length, ...ordered)
      return {} as never
    },
    getState: () => ({}) as never
  }
  return {
    titles: () => orderedTabs().map((candidate) => candidate.pinned ? `${candidate.title} (pinned)` : candidate.title),
    close: (title: string) => {
      const closing = open.find((candidate) => candidate.title === title)!
      rememberClosedTab(access, closing)
      open.splice(open.indexOf(closing), 1)
    },
    reopen: (closedTabId?: string) => reopenClosedTabEntry(access, closedTabId, true),
    closedTabs,
    access
  }
}

describe('reopening a closed tab', () => {
  // Reopen closed tab put the tab after the last of its workspace's tabs; Chrome puts it back where it was.
  it('puts the tab back where it was among its workspace\'s tabs', async () => {
    const tabs = strip([{ title: 'a' }, { title: 'b' }, { title: 'c' }])
    tabs.close('b')
    expect(tabs.closedTabs[0]).toMatchObject({ url: 'https://example.test/b', index: 1 })

    await tabs.reopen()

    expect(tabs.titles()).toEqual(['a', 'b', 'c'])
  })

  it('brings back tabs closed one after another in their places, the last closed first', async () => {
    const tabs = strip([{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }])
    tabs.close('b')
    tabs.close('c')
    tabs.close('a')

    await tabs.reopen()
    expect(tabs.titles()).toEqual(['a', 'd'])
    await tabs.reopen()
    expect(tabs.titles()).toEqual(['a', 'c', 'd'])
    await tabs.reopen()
    expect(tabs.titles()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('counts its place among the pinned tabs or the others, as it was, and in its own workspace', async () => {
    const tabs = strip([
      { title: 'pinned-a', pinned: true }, { title: 'pinned-b', pinned: true }, { title: 'a' }, { title: 'b' },
      { title: 'client-a', workspace: 'client' }, { title: 'client-b', workspace: 'client' }
    ])
    tabs.close('pinned-a')
    tabs.close('client-a')
    tabs.close('b')

    for (let reopened = 0; reopened < 3; reopened += 1) await tabs.reopen()

    expect(tabs.titles()).toEqual(['pinned-a (pinned)', 'pinned-b (pinned)', 'a', 'b', 'client-a', 'client-b'])
  })

  it('goes after the last of its workspace\'s tabs when fewer are open now, and opens one chosen from the list in its place', async () => {
    const tabs = strip([{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }])
    tabs.close('d')
    tabs.close('c')
    tabs.close('b')
    const d = tabs.closedTabs.find((closed) => closed.url.endsWith('/d'))!

    await tabs.reopen(d.id)
    expect(tabs.titles()).toEqual(['a', 'd'])
    await tabs.reopen()
    expect(tabs.titles()).toEqual(['a', 'b', 'd'])
  })

  it('stays last when it was remembered without a place, as before', async () => {
    const tabs = strip([{ title: 'a' }, { title: 'b' }])
    tabs.closedTabs.push({ id: 'closed-x', title: 'x', url: 'https://example.test/x', pinned: false, closedAt: '2026-10-22T04:00:00.000Z' })

    await tabs.reopen()

    expect(tabs.titles()).toEqual(['a', 'b', 'x'])
  })
})
