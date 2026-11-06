import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserClosedTabState } from '../src/shared/types.js'
import type { BrowserSplitViewState } from '../src/shared/split-view.js'
import { rememberClosedTab, reopenClosedTabEntry } from '../src/main/browser/tab-reopening/tab-reopening.js'
import { openSplitView, updateSplitView } from '../src/main/browser/split-view/split-view.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'

vi.mock('../src/main/browser/browser-core.js', () => ({
  orderedTabs: (browser: { orderedTabs(): unknown }) => browser.orderedTabs(),
  findTab: (browser: { findTab(tabId: string): unknown }, tabId: string) => browser.findTab(tabId)
}))
// Its place among the tabs is reopen-closed-tab-place.test.ts's.
vi.mock('../src/main/browser/tab-arrangement/tab-arrangement.js', () => ({ reorderTab: () => undefined }))
vi.mock('../src/main/browser/split-view/split-view.js', () => ({
  openSplitView: vi.fn(),
  updateSplitView: vi.fn()
}))

type PaneTab = Pick<BrowserTab, 'id' | 'url' | 'title' | 'pinned' | 'mcpGroupId' | 'zoomIsolated' | 'tabMuted' | 'tabAgentPaused' | 'humanInteractionLocked'>
  & { webContents: { isDestroyed(): boolean } }

/**
 * Open tabs and the split view, as the tab manager keeps them: closing a pane remembers it while it is still open, ends
 * the split and leaves the tab beside it shown, as closing a tab does, and a tab reopened to be shown becomes the one shown.
 */
function window(titles: string[], split?: Omit<BrowserSplitViewState, 'firstTabId' | 'secondTabId'> & { first: string; second: string }) {
  let created = 0
  const open: PaneTab[] = []
  const closedTabs: BrowserClosedTabState[] = []
  function tab(title: string, workspace?: string): PaneTab {
    created += 1
    const opened: PaneTab = {
      id: `tab-${created}`, url: `https://example.test/${title}`, title, pinned: false, zoomIsolated: false, tabMuted: false,
      tabAgentPaused: false, humanInteractionLocked: false, webContents: { isDestroyed: () => false },
      ...(workspace ? { mcpGroupId: workspace } : {})
    }
    open.push(opened)
    return opened
  }
  for (const title of titles) tab(title)
  const byTitle = (title: string): PaneTab => open.find((candidate) => candidate.title === title)!
  const manager = {
    closedTabs,
    detachedClosedTabs: new Set<BrowserClosedTabState[]>(),
    tabs: { get size() { return open.length } },
    activeTabId: split ? byTitle(split.first).id : open[0]?.id ?? null as string | null,
    splitView: split
      ? { firstTabId: byTitle(split.first).id, secondTabId: byTitle(split.second).id, orientation: split.orientation, ratio: split.ratio }
      : null as BrowserSplitViewState | null,
    orderedTabs: () => [...open],
    findTab: (tabId: string) => open.find((candidate) => candidate.id === tabId),
    navigationHistorySnapshot: () => ({ entries: [], index: 0 }),
    createTab: async (options: Parameters<Browser['createTab']>[0]): Promise<PaneTab> => {
      const reopened = tab(options.url.split('/').at(-1)!, options.mcpGroupId)
      if (options.active) manager.activeTabId = reopened.id
      return reopened
    }
  }
  return {
    manager,
    tab: byTitle,
    show: (title: string) => { manager.activeTabId = byTitle(title).id },
    close: (title: string) => {
      const closing = byTitle(title)
      rememberClosedTab(manager as unknown as Browser, closing as unknown as BrowserTab)
      const split = manager.splitView
      if (split && (split.firstTabId === closing.id || split.secondTabId === closing.id)) {
        manager.activeTabId = split.firstTabId === closing.id ? split.secondTabId : split.firstTabId
        manager.splitView = null
      } else if (manager.activeTabId === closing.id) {
        manager.activeTabId = open.find((candidate) => candidate !== closing)?.id ?? null
      }
      open.splice(open.indexOf(closing), 1)
    },
    reopen: (active = true) => reopenClosedTabEntry(manager as unknown as Browser, undefined, active)
  }
}

afterEach(() => {
  vi.mocked(openSplitView).mockReset()
  vi.mocked(updateSplitView).mockReset()
  vi.restoreAllMocks()
})

describe('reopening a tab closed from a split view', () => {
  // Closing a pane left the tab beside it shown alone, and Undo or Reopen closed tab then showed only the reopened tab,
  // hiding that one too: the split, its side and its proportion were gone.
  it('puts it back beside the tab it was shown with, on its side and with the split\'s layout', async () => {
    const right = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'horizontal', ratio: 0.3 })
    const a = right.tab('a')
    right.close('b')
    expect(right.manager.splitView).toBeNull()

    const reopened = await right.reopen()

    expect(reopened).toMatchObject({ title: 'b' })
    // Shown beside a, the reopened tab comes first, so it swaps to the second pane, where it was.
    expect(openSplitView).toHaveBeenCalledExactlyOnceWith(right.manager, a.id)
    expect(updateSplitView).toHaveBeenCalledExactlyOnceWith(right.manager, { orientation: 'horizontal', ratio: 0.3, swap: true })

    const left = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.7 })
    const b = left.tab('b')
    left.close('a')
    await left.reopen()
    expect(openSplitView).toHaveBeenLastCalledWith(left.manager, b.id)
    expect(updateSplitView).toHaveBeenLastCalledWith(left.manager, { orientation: 'vertical', ratio: 0.7, swap: false })
  })

  it('opens it alone when the tab beside it is not the one shown, another split is open, or that tab is gone', async () => {
    const otherTab = window(['a', 'b', 'c'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
    otherTab.close('b')
    otherTab.show('c')
    await otherTab.reopen()

    const otherSplit = window(['a', 'b', 'c'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
    otherSplit.close('b')
    otherSplit.manager.splitView = {
      firstTabId: otherSplit.tab('a').id, secondTabId: otherSplit.tab('c').id, orientation: 'vertical', ratio: 0.5
    }
    await otherSplit.reopen()

    const gone = window(['a', 'b', 'c'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
    gone.close('b')
    gone.close('a')
    // a reopens first and is not in a split; b then finds the tab it was beside gone, as a reopened a is another tab.
    await gone.reopen()
    await gone.reopen()

    const crashed = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
    crashed.close('b')
    crashed.tab('a').webContents = { isDestroyed: () => true }
    await crashed.reopen()

    expect(openSplitView).not.toHaveBeenCalled()
    expect(updateSplitView).not.toHaveBeenCalled()
  })

  it('opens it alone when it reopens behind or in another workspace than the tab it was beside', async () => {
    const behind = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
    behind.close('b')
    await behind.reopen(false)

    const moved = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
    moved.close('b')
    moved.tab('a').mcpGroupId = 'client'
    await moved.reopen()

    expect(openSplitView).not.toHaveBeenCalled()
  })

  it('still opens it when the split view cannot be put back', async () => {
    const split = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
    split.close('b')
    vi.mocked(openSplitView).mockImplementation(() => { throw new Error('The view is gone') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(split.reopen()).resolves.toMatchObject({ title: 'b' })

    expect(logged).toHaveBeenCalledWith('[browser] Could not put a reopened tab back into its split view:', expect.any(Error))
    expect(updateSplitView).not.toHaveBeenCalled()
  })
})
