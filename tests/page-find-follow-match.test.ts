import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const { stopFindInPage } = await import('../src/main/browser/page-find/page-find.js')
type PageFindAccess = import('../src/main/browser/page-find/page-find-access.js').PageFindAccess<PageTab>
type PageTab = { id: string; locked: boolean; webContents: WebContents }

function pageSearch(locked = false) {
  const tab: PageTab = { id: 'tab', locked, webContents: { id: 4 } as WebContents }
  const stopPageSearch = vi.fn()
  const access: PageFindAccess = {
    getTab: () => tab,
    searchPage: vi.fn(),
    stopPageSearch,
    isHumanInteractionLocked: (candidate) => candidate.locked
  }
  return { tab, access, stopPageSearch }
}

describe('ending a page search', () => {
  it('clears the selection by default', () => {
    const page = pageSearch()
    stopFindInPage(page.access, 'tab')
    expect(page.stopPageSearch).toHaveBeenCalledExactlyOnceWith(page.tab.webContents, 'clearSelection')
  })

  it('clicks the active match when asked, as Ctrl+Enter in Chrome\'s find bar follows the link it is in', () => {
    const page = pageSearch()
    stopFindInPage(page.access, 'tab', { activateMatch: true })
    expect(page.stopPageSearch).toHaveBeenCalledExactlyOnceWith(page.tab.webContents, 'activateSelection')
  })

  it('only ends the search of a tab whose input is locked, since the click would be the person\'s input', () => {
    const page = pageSearch(true)
    stopFindInPage(page.access, 'tab', { activateMatch: true })
    expect(page.stopPageSearch).toHaveBeenCalledExactlyOnceWith(page.tab.webContents, 'clearSelection')
  })
})
