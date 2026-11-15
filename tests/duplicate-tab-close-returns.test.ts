import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
// The fake browser below places the copy itself and has no state to publish, which duplicating a tab ends with.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: () => ({})
}))
vi.mock('../src/main/browser/tab-arrangement/tab-arrangement.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-arrangement/tab-arrangement.js')>(),
  reorderTab: vi.fn()
}))
import { Browser } from '../src/main/browser/browser.js'
import { closeTabTransition } from '../src/main/browser/tab-close/close-transition.js'
import { duplicateTabAfterLabelSave } from '../src/main/browser/tab-reopening/tab-reopening.js'
import { writeActiveTabId } from '../src/main/browser/tab-selection/active-tab.js'

// A copy of a tab closed right away showed the tab after it, which had been after the copied tab, where Chrome shows
// the tab the person was on.

interface Tab {
  id: string; url: string; title: string; pinned: boolean; mcpGroupId?: string; returnsToTabId?: string
  webContents: { isDestroyed: () => boolean }
}

const tab = (id: string, workspace?: string): Tab => ({
  id, url: id === 'home' ? 'hronaut://home/' : `https://${id}.example/`, title: id, pinned: false,
  ...(workspace ? { mcpGroupId: workspace } : {}), webContents: { isDestroyed: () => false }
})

/** Copies a tab while another is shown, and gives the tab shown when the copy closes right away. */
async function closingCopy(copied: string, shown: string): Promise<{ copy: Tab; next: string | undefined }> {
  const tabs = new Map([tab('home'), tab('a', 'work'), tab('b', 'work'), tab('c', 'work'), tab('x', 'other')].map((open) => [open.id, open]))
  const browser = Object.assign(Object.create(Browser.prototype), {
    tabs,
    activeTabId: shown,
    splitView: null,
    mcpTabGroups: new Map([['work', { id: 'work', name: 'Work' }], ['other', { id: 'other', name: 'Other' }]]),
    navigationHistorySnapshot: () => undefined,
    // Opens the copy right after the copied tab and shows it, as createTab and reorderTab do.
    createTab: async (options: { mcpGroupId?: string; onCreated?: (created: Tab) => void }) => {
      const copy = { ...tab('copy', options.mcpGroupId), url: tabs.get(copied)!.url }
      const order = [...tabs.values()]
      order.splice(order.findIndex((open) => open.id === copied) + 1, 0, copy)
      tabs.clear()
      for (const open of order) tabs.set(open.id, open)
      writeActiveTabId(browser, copy.id)
      options.onCreated?.(copy)
      return copy
    }
  }) as Browser
  await duplicateTabAfterLabelSave(browser, copied)
  const copy = tabs.get('copy')!
  return { copy, next: closeTabTransition(browser, copy as never).nextId }
}

describe('a copy of a tab closed right away', () => {
  it('shows the tab the person was on, as in Chrome', async () => {
    expect((await closingCopy('b', 'b')).next).toBe('b')
    // Copied from its menu while another tab of its workspace was shown.
    expect((await closingCopy('a', 'c')).next).toBe('c')
  })

  it('shows the tab beside it when the person was on Home or on another workspace\'s tab', async () => {
    for (const shown of ['home', 'x']) {
      const { copy, next } = await closingCopy('b', shown)
      expect(copy).not.toHaveProperty('returnsToTabId')
      expect(next).toBe('c')
    }
  })
})
