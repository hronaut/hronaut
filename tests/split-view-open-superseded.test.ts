import { describe, expect, it, vi } from 'vitest'
import type { View, WebContents } from 'electron'
import { openSplitViewAndWait } from '../src/main/browser/split-view/split-view.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import type { BrowserState } from '../src/shared/types.js'
import type { BrowserSplitViewState } from '../src/shared/split-view.js'

vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
vi.mock('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js', () => ({
  focusTabOrTrustedChrome: (browser: { focusTabOrTrustedChrome: (tab: unknown) => void }, tab: unknown) => browser.focusTabOrTrustedChrome(tab)
}))

// The person chose Open in Split View with a sleeping tab and, while it woke, picked another tab or closed that tab.
// Their newer action wins, yet when the wake then failed, or the closed tab could no longer be shown, the split view
// they no longer wanted reported an error.

function tab(id: string): BrowserTab {
  return {
    id, url: `https://${id}.example/`, sleeping: id === 'reference', lastActiveAt: 0,
    view: {} as View, webContents: { isDestroyed: () => false } as unknown as WebContents
  } as BrowserTab
}

/** The tab manager's split view state, with the chosen tab's wake finished by the test. */
function browser() {
  const tabs = new Map([['notes', tab('notes')], ['reference', tab('reference')], ['other', tab('other')]])
  let finishWake!: (error?: Error) => void
  const wake = new Promise<void>((resolve, reject) => { finishWake = (error) => (error ? reject(error) : resolve()) })
  const state = {
    tabs,
    activeTabId: 'notes' as string | null,
    splitView: null as BrowserSplitViewState | null,
    splitViewGeneration: 0,
    tabSelectionGeneration: 0,
    wakeTab: async (tabId: string) => {
      if (tabId === 'reference') await wake
      return {} as BrowserState
    },
    window: { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } },
    splitDivider: { cancel: vi.fn() },
    layout: vi.fn(), focusTabOrTrustedChrome: vi.fn(), changed: vi.fn(),
    getState: () => ({ activeTabId: state.activeTabId, splitView: state.splitView }) as BrowserState
  }
  return {
    manager: state as unknown as Browser, state, finishWake,
    /** The person picks another tab, as selecting a tab does. */
    select: (tabId: string) => { state.tabSelectionGeneration += 1; state.activeTabId = tabId },
    close: (tabId: string) => { tabs.delete(tabId) }
  }
}

describe('opening a split view with a sleeping tab', () => {
  it('returns quietly when the person picked another tab and the wake then failed', async () => {
    const { manager, state, finishWake, select } = browser()
    const opening = openSplitViewAndWait(manager, 'reference')
    select('other')
    finishWake(new Error('The site could not be reached.'))

    await expect(opening).resolves.toEqual({ activeTabId: 'other', splitView: null })
    expect(state.splitView).toBeNull()
  })

  it('returns quietly when the person closed the chosen tab while it woke', async () => {
    const { manager, state, finishWake, close } = browser()
    const opening = openSplitViewAndWait(manager, 'reference')
    close('reference')
    finishWake()

    await expect(opening).resolves.toEqual({ activeTabId: 'notes', splitView: null })
    expect(state.splitView).toBeNull()
  })

  it('still reports a failed wake that nothing replaced', async () => {
    const { manager, state, finishWake } = browser()
    const opening = openSplitViewAndWait(manager, 'reference')
    finishWake(new Error('The site could not be reached.'))

    await expect(opening).rejects.toThrow('The site could not be reached.')
    expect(state.splitView).toBeNull()
    // The request still counted as a selection, so the shell learns that, such as a followed agent's mark going.
    expect(state.changed).toHaveBeenCalledWith(false)
  })

  it('opens both tabs side by side once the chosen tab wakes', async () => {
    const { manager, state, finishWake } = browser()
    const opening = openSplitViewAndWait(manager, 'reference')
    finishWake()

    await opening
    expect(state.splitView).toMatchObject({ firstTabId: 'notes', secondTabId: 'reference' })
  })
})
