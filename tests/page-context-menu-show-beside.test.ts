import { describe, expect, it, vi } from 'vitest'

// Open Link in Split View shows the link's new tab beside the page it was chosen on, unless the person went to another
// tab or the page's tab closed while the new tab opened: then the newer choice stays in front.

const opened = vi.hoisted(() => ({ splitViews: [] as Array<{ tabId: string, options: unknown }> }))

vi.mock('electron', () => ({
  session: {}, webContents: { getFocusedWebContents: () => null }, WebContentsView: class {}, nativeImage: {}, shell: {},
  app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {}
}))

vi.mock('../src/main/browser/split-view/split-view.js', async (original) => ({
  ...await original<typeof import('../src/main/browser/split-view/split-view.js')>(),
  openSplitViewAndWait: vi.fn(async (_access: unknown, tabId: string, options: unknown) => {
    opened.splitViews.push({ tabId, options })
    return {}
  })
}))

const { Browser } = await import('../src/main/browser/browser.js')

interface Tab { id: string }
interface Manager {
  tabs: Map<string, Tab>
  activeTabId: string | null
  pageContextMenuAccess(): { showBeside(tab: Tab, besideTabId: string): Promise<void> }
}

function browser() {
  opened.splitViews.length = 0
  const page = { id: 'page' }
  const manager = Object.assign(Object.create(Browser.prototype), {
    tabs: new Map([['page', page], ['link', { id: 'link' }], ['other', { id: 'other' }]]),
    activeTabId: 'page'
  }) as Manager
  return { manager, page, showBeside: (tab: Tab) => manager.pageContextMenuAccess().showBeside(tab, 'link') }
}

describe('showing a link\'s new tab beside the page it was opened from', () => {
  it('opens the split view for a link opened beside the page', async () => {
    const { page, showBeside } = browser()
    await showBeside(page)
    expect(opened.splitViews).toEqual([{ tabId: 'link', options: { openedBeside: true } }])
  })

  it('leaves the tabs alone once the person went to another tab or the page\'s tab closed', async () => {
    const elsewhere = browser()
    elsewhere.manager.activeTabId = 'other'
    await elsewhere.showBeside(elsewhere.page)
    expect(opened.splitViews).toEqual([])

    const closed = browser()
    closed.manager.tabs.delete('page')
    await closed.showBeside(closed.page)
    expect(opened.splitViews).toEqual([])
  })
})
