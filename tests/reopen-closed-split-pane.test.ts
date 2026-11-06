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
 * Open tabs and the split view, as the tab manager keeps them: selecting a tab outside the split view ends it, closing a
 * pane remembers it while it is still open, ends the split and leaves the tab beside it shown, as closing a tab does, and
 * a tab created to be shown is selected.
 */
function window(titles: string[], split?: Omit<BrowserSplitViewState, 'firstTabId' | 'secondTabId'> & { first: string; second: string; active?: string }) {
  let created = 0
  const open: PaneTab[] = []
  const closedTabs: BrowserClosedTabState[] = []
  function tab(title: string): PaneTab {
    created += 1
    const opened: PaneTab = {
      id: `tab-${created}`, url: `https://example.test/${title}`, title, pinned: false, zoomIsolated: false, tabMuted: false,
      tabAgentPaused: false, humanInteractionLocked: false, webContents: { isDestroyed: () => false }
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
    activeTabId: split ? byTitle(split.active ?? split.first).id : open[0]?.id ?? null as string | null,
    splitView: split
      ? { firstTabId: byTitle(split.first).id, secondTabId: byTitle(split.second).id, orientation: split.orientation, ratio: split.ratio }
      : null as BrowserSplitViewState | null,
    orderedTabs: () => [...open],
    findTab: (tabId: string) => open.find((candidate) => candidate.id === tabId),
    navigationHistorySnapshot: () => ({ entries: [], index: 0 }),
    selectTab: vi.fn((tabId: string) => {
      if (manager.splitView?.firstTabId !== tabId && manager.splitView?.secondTabId !== tabId) manager.splitView = null
      manager.activeTabId = tabId
    }),
    opening: undefined as (() => void) | undefined,
    createTab: vi.fn(async (options: Parameters<Browser['createTab']>[0]): Promise<PaneTab> => {
      const reopened = tab(options.url.split('/').at(-1)!)
      manager.opening?.()
      if (options.active) manager.selectTab(reopened.id)
      return reopened
    })
  }
  const close = (title: string) => {
    const closing = byTitle(title)
    rememberClosedTab(manager as unknown as Browser, closing as unknown as BrowserTab)
    const shown = manager.splitView
    if (shown && (shown.firstTabId === closing.id || shown.secondTabId === closing.id)) {
      manager.activeTabId = shown.firstTabId === closing.id ? shown.secondTabId : shown.firstTabId
      manager.splitView = null
    } else if (manager.activeTabId === closing.id) {
      manager.activeTabId = open.find((candidate) => candidate !== closing)?.id ?? null
    }
    open.splice(open.indexOf(closing), 1)
  }
  return {
    manager,
    tab: byTitle,
    close,
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
  it('puts it back beside the tab it was shown with, on its side, with the split\'s layout, and the same pane active', async () => {
    const bottom = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'horizontal', ratio: 0.3 })
    const a = bottom.tab('a')
    bottom.close('b')
    expect(bottom.manager.splitView).toBeNull()

    const b = await bottom.reopen()

    // It opens behind, so the page shown is never hidden, and goes beside it at the bottom; a stays the active pane, and
    // keeps the keyboard while b's page loads.
    expect(bottom.manager.createTab).toHaveBeenCalledWith(expect.objectContaining({ active: false }))
    expect(openSplitView).toHaveBeenCalledExactlyOnceWith(bottom.manager, b!.id, { openedBeside: true })
    expect(updateSplitView).toHaveBeenCalledExactlyOnceWith(bottom.manager, { orientation: 'horizontal', ratio: 0.3, swap: false })
    expect(bottom.manager.selectTab).not.toHaveBeenCalled()
    expect(bottom.manager.activeTabId).toBe(a.id)

    // The left pane, the active one, goes back on the left and is the active pane again.
    const left = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.7 })
    left.close('a')
    const reopenedA = await left.reopen()
    expect(openSplitView).toHaveBeenLastCalledWith(left.manager, reopenedA!.id, { openedBeside: false })
    expect(updateSplitView).toHaveBeenLastCalledWith(left.manager, { orientation: 'vertical', ratio: 0.7, swap: true })
    expect(left.manager.selectTab).toHaveBeenCalledExactlyOnceWith(reopenedA!.id)
  })

  it('shows it alone when the tab beside it is not the one shown, another split is open, or that tab goes away', async () => {
    const shownAlone = async (setUp: (split: ReturnType<typeof window>) => void) => {
      const split = window(['a', 'b', 'c'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
      split.close('b')
      setUp(split)
      const b = await split.reopen()
      expect(split.manager.activeTabId).toBe(b!.id)
      expect(split.manager.splitView).toBeNull()
    }

    await shownAlone((split) => { split.manager.activeTabId = split.tab('c').id })
    // Showing b ends the person's split of a and c, as showing any tab outside a split view does.
    await shownAlone((split) => {
      split.manager.splitView = { firstTabId: split.tab('a').id, secondTabId: split.tab('c').id, orientation: 'vertical', ratio: 0.5 }
    })
    await shownAlone((split) => {
      split.manager.opening = () => { split.close('a') }
    })
    await shownAlone((split) => {
      split.manager.opening = () => { split.tab('a').webContents = { isDestroyed: () => true } }
    })
    await shownAlone((split) => {
      split.manager.opening = () => { split.manager.activeTabId = split.tab('c').id }
    })

    expect(openSplitView).not.toHaveBeenCalled()
    expect(updateSplitView).not.toHaveBeenCalled()
  })

  it('opens it behind, outside a split view, when it reopens behind', async () => {
    const split = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
    const a = split.tab('a')
    split.close('b')

    await split.reopen(false)

    expect(openSplitView).not.toHaveBeenCalled()
    expect(split.manager.selectTab).not.toHaveBeenCalled()
    expect(split.manager.activeTabId).toBe(a.id)
  })

  it('shows it alone when the split view cannot be put back', async () => {
    const split = window(['a', 'b'], { first: 'a', second: 'b', orientation: 'vertical', ratio: 0.5 })
    split.close('b')
    vi.mocked(openSplitView).mockImplementation(() => { throw new Error('The view is gone') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const b = await split.reopen()

    expect(logged).toHaveBeenCalledWith('[browser] Could not put a reopened tab back into its split view:', expect.any(Error))
    expect(updateSplitView).not.toHaveBeenCalled()
    expect(split.manager.selectTab).toHaveBeenCalledExactlyOnceWith(b!.id)
  })
})
