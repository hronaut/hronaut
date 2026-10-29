import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { View, WebContents } from 'electron'
import { openSplitView } from '../src/main/browser/split-view/split-view.js'
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

// A link opened beside the page took the keyboard when its pane first showed, though the person was still reading
// the page they opened it from.

type FakeContents = EventEmitter & { shown: string, loading: boolean, focused: boolean, destroyed: boolean }

/** A tab whose page shows its address, or, still loading its first document, nothing yet. */
function tab(id: string, loading = false): BrowserTab & { webContents: WebContents & FakeContents } {
  const contents = Object.assign(new EventEmitter(), { shown: loading ? '' : `https://${id}.example/`, loading, focused: false, destroyed: false })
  Object.assign(contents, {
    getURL: () => contents.shown,
    isDestroyed: () => contents.destroyed,
    isLoadingMainFrame: () => contents.loading,
    isFocused: () => contents.focused
  })
  return {
    id, url: `https://${id}.example/`, sleeping: false, lastActiveAt: 0,
    view: {} as View, webContents: contents as unknown as WebContents & FakeContents
  } as BrowserTab & { webContents: WebContents & FakeContents }
}

/** The tab manager's split view state, with the guide active and the link's tab still loading. */
function browser() {
  const guide = tab('guide')
  const link = tab('link', true)
  const tabs = new Map([['guide', guide], ['link', link], ['other', tab('other')]])
  const focusTabOrTrustedChrome = vi.fn()
  const state = {
    tabs,
    activeTabId: 'guide' as string | null,
    splitView: null as BrowserSplitViewState | null,
    splitViewGeneration: 0,
    tabSelectionGeneration: 0,
    wakeTab: async () => ({}) as BrowserState,
    window: { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } },
    splitDivider: { cancel: vi.fn() },
    layout: vi.fn(), focusTabOrTrustedChrome, changed: vi.fn(),
    getState: () => ({ activeTabId: state.activeTabId, splitView: state.splitView }) as BrowserState
  }
  return { manager: state as unknown as Browser, state, guide, link, focusTabOrTrustedChrome }
}

const beside = { openedBeside: true }

/** The loading pane's view shows and Chromium gives it the keyboard. */
async function takesKeyboard(contents: FakeContents): Promise<void> {
  contents.focused = true
  contents.emit('focus')
  await new Promise(resolve => setImmediate(resolve))
}

describe('the keyboard while a pane beside the page loads its first document', () => {
  it('goes back to the active pane until that document arrives', async () => {
    const { manager, guide, link, focusTabOrTrustedChrome } = browser()
    openSplitView(manager, 'link', beside)
    expect(focusTabOrTrustedChrome).toHaveBeenCalledExactlyOnceWith(guide)

    await takesKeyboard(link.webContents)
    expect(focusTabOrTrustedChrome).toHaveBeenCalledTimes(2)
    expect(focusTabOrTrustedChrome).toHaveBeenLastCalledWith(guide)

    // Once the page navigated, a click into it is the person's choice.
    link.webContents.loading = false
    link.webContents.emit('did-navigate')
    await takesKeyboard(link.webContents)
    expect(focusTabOrTrustedChrome).toHaveBeenCalledTimes(2)
    expect(link.webContents.eventNames()).toEqual([])
  })

  it('stays with the loading pane once the person or an agent made it active, or the split changed', async () => {
    const madeActive = browser()
    openSplitView(madeActive.manager, 'link', beside)
    madeActive.state.activeTabId = 'link'
    await takesKeyboard(madeActive.link.webContents)
    expect(madeActive.focusTabOrTrustedChrome).toHaveBeenCalledOnce()

    const changed = browser()
    openSplitView(changed.manager, 'link', beside)
    changed.state.splitViewGeneration += 1
    await takesKeyboard(changed.link.webContents)
    expect(changed.focusTabOrTrustedChrome).toHaveBeenCalledOnce()
  })

  it('is left alone when the keyboard already moved on, the load failed or the pane was destroyed', async () => {
    const movedOn = browser()
    openSplitView(movedOn.manager, 'link', beside)
    movedOn.link.webContents.emit('focus')
    movedOn.link.webContents.focused = false
    await new Promise(resolve => setImmediate(resolve))
    expect(movedOn.focusTabOrTrustedChrome).toHaveBeenCalledOnce()

    for (const end of ['did-fail-load', 'did-stop-loading', 'destroyed']) {
      const { manager, link, focusTabOrTrustedChrome } = browser()
      openSplitView(manager, 'link', beside)
      link.webContents.emit(end)
      expect(link.webContents.eventNames()).toEqual([])
      await takesKeyboard(link.webContents)
      expect(focusTabOrTrustedChrome).toHaveBeenCalledOnce()
    }
  })

  it('is not watched for a pane that already shows its page, or that the person put beside the page', async () => {
    const shown = browser()
    shown.link.webContents.loading = false
    shown.link.webContents.shown = 'https://link.example/'
    openSplitView(shown.manager, 'link', beside)
    expect(shown.link.webContents.eventNames()).toEqual([])
    await takesKeyboard(shown.link.webContents)
    expect(shown.focusTabOrTrustedChrome).toHaveBeenCalledOnce()

    // Chosen from the tab strip, the tab is what the person wants to look at.
    const chosen = browser()
    openSplitView(chosen.manager, 'link')
    expect(chosen.link.webContents.eventNames()).toEqual([])
  })

  it('is watched for a new tab whose load has not started yet', async () => {
    const { manager, link, guide, focusTabOrTrustedChrome } = browser()
    link.webContents.loading = false
    openSplitView(manager, 'link', beside)
    await takesKeyboard(link.webContents)
    expect(focusTabOrTrustedChrome).toHaveBeenLastCalledWith(guide)
    expect(focusTabOrTrustedChrome).toHaveBeenCalledTimes(2)
  })

  it('keeps one watch on a pane opened beside again, and drops it once the split changed', async () => {
    const { manager, state, link, focusTabOrTrustedChrome } = browser()
    openSplitView(manager, 'link', beside)
    openSplitView(manager, 'link', beside)
    expect(link.webContents.listenerCount('focus')).toBe(1)
    await takesKeyboard(link.webContents)
    expect(focusTabOrTrustedChrome).toHaveBeenCalledTimes(3)

    state.splitViewGeneration += 1
    await takesKeyboard(link.webContents)
    expect(focusTabOrTrustedChrome).toHaveBeenCalledTimes(3)
    expect(link.webContents.eventNames()).toEqual([])
  })
})
