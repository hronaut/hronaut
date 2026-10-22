import { describe, expect, it, vi } from 'vitest'
import type { View, WebContents } from 'electron'
import { openSplitViewAndWait } from '../src/main/browser/split-view/split-view.js'
import type { SplitViewAccess, SplitViewTab } from '../src/main/browser/split-view/split-view-access.js'
import type { BrowserState } from '../src/shared/types.js'
import type { BrowserSplitViewState } from '../src/shared/split-view.js'

// The person chose Open in Split View with a sleeping tab and, while it woke, picked another tab or closed that tab.
// Their newer action wins, yet when the wake then failed, or the closed tab could no longer be shown, the split view
// they no longer wanted reported an error.

function tab(id: string): SplitViewTab {
  return {
    id, url: `https://${id}.example/`, sleeping: id === 'reference', lastActiveAt: 0,
    view: {} as View, webContents: { isDestroyed: () => false } as unknown as WebContents
  }
}

/** The tab manager's split view state, with the chosen tab's wake finished by the test. */
function browser() {
  const tabs = new Map([['notes', tab('notes')], ['reference', tab('reference')], ['other', tab('other')]])
  const state = { activeTabId: 'notes' as string | null, splitView: null as BrowserSplitViewState | null, splitViewGeneration: 0, tabSelectionGeneration: 0 }
  let finishWake!: (error?: Error) => void
  const wake = new Promise<void>((resolve, reject) => { finishWake = (error) => (error ? reject(error) : resolve()) })
  const getTab = (tabId?: string) => {
    const found = tabs.get(tabId ?? state.activeTabId ?? '')
    if (!found) throw new Error('The tab is no longer available.')
    return found
  }
  const access: SplitViewAccess<SplitViewTab> = {
    getActiveTab: () => getTab(),
    getTab,
    findTab: (tabId) => tabs.get(tabId),
    splitView: () => state.splitView,
    writeSplitView: (splitView) => { state.splitView = splitView },
    splitViewGeneration: () => state.splitViewGeneration,
    writeSplitViewGeneration: (generation) => { state.splitViewGeneration = generation },
    tabSelectionGeneration: () => state.tabSelectionGeneration,
    writeTabSelectionGeneration: (generation) => { state.tabSelectionGeneration = generation },
    activeTabId: () => state.activeTabId,
    wakeTab: async (tabId) => {
      if (tabId === 'reference') await wake
      return {} as BrowserState
    },
    addChildView: vi.fn(), removeChildView: vi.fn(), cancelSplitDivider: vi.fn(), getSplitDivider: () => null,
    layout: vi.fn(), focusTabOrTrustedChrome: vi.fn(), changed: vi.fn(),
    getState: () => ({ activeTabId: state.activeTabId, splitView: state.splitView }) as BrowserState
  }
  return {
    access, state, finishWake,
    /** The person picks another tab, as selecting a tab does. */
    select: (tabId: string) => { state.tabSelectionGeneration += 1; state.activeTabId = tabId },
    close: (tabId: string) => { tabs.delete(tabId) }
  }
}

describe('opening a split view with a sleeping tab', () => {
  it('returns quietly when the person picked another tab and the wake then failed', async () => {
    const { access, state, finishWake, select } = browser()
    const opening = openSplitViewAndWait(access, 'reference')
    select('other')
    finishWake(new Error('The site could not be reached.'))

    await expect(opening).resolves.toEqual({ activeTabId: 'other', splitView: null })
    expect(state.splitView).toBeNull()
  })

  it('returns quietly when the person closed the chosen tab while it woke', async () => {
    const { access, state, finishWake, close } = browser()
    const opening = openSplitViewAndWait(access, 'reference')
    close('reference')
    finishWake()

    await expect(opening).resolves.toEqual({ activeTabId: 'notes', splitView: null })
    expect(state.splitView).toBeNull()
  })

  it('still reports a failed wake that nothing replaced', async () => {
    const { access, state, finishWake } = browser()
    const opening = openSplitViewAndWait(access, 'reference')
    finishWake(new Error('The site could not be reached.'))

    await expect(opening).rejects.toThrow('The site could not be reached.')
    expect(state.splitView).toBeNull()
  })

  it('opens both tabs side by side once the chosen tab wakes', async () => {
    const { access, state, finishWake } = browser()
    const opening = openSplitViewAndWait(access, 'reference')
    finishWake()

    await opening
    expect(state.splitView).toMatchObject({ firstTabId: 'notes', secondTabId: 'reference' })
  })
})
