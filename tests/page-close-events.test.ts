import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { attachPageCloseEvents } from '../src/main/browser/tab-events/page-close-events.js'
import type { PageCloseEventsAccess, PageCloseEventsTab } from '../src/main/browser/tab-events/page-close-events-access.js'

// A sign-in popup that closed itself with window.close() left a tab saying its page was no longer available.

function fixture(options: { closeTab?: () => Promise<never> } = {}) {
  const tab: PageCloseEventsTab = { id: 'popup' }
  const page = new EventEmitter() as EventEmitter & WebContents
  const tabs = new Map([[tab.id, tab]])
  const expectedTabClosures = new WeakSet<WebContents>()
  let destroyed = false
  const access: PageCloseEventsAccess<PageCloseEventsTab> = {
    isDestroyed: () => destroyed,
    findTab: (tabId) => tabs.get(tabId),
    expectedTabClosures: () => expectedTabClosures,
    closeTab: vi.fn(options.closeTab ?? (async () => ({}) as never)),
    recoverDestroyedPage: vi.fn()
  }
  attachPageCloseEvents(access, tab, page)
  return { tab, page, tabs, expectedTabClosures, access, closeBrowser: () => { destroyed = true } }
}

describe('a page opened for a window that closes itself', () => {
  it('closes its tab, and its destruction shows no problem', () => {
    const { page, access, expectedTabClosures } = fixture()
    page.emit('close')
    expect(access.closeTab).toHaveBeenCalledWith('popup')
    expect(expectedTabClosures.has(page)).toBe(true)
    page.emit('close')
    expect(access.closeTab).toHaveBeenCalledTimes(1)
  })

  it('leaves a close Hronaut makes itself alone', () => {
    const closed = fixture()
    closed.tabs.delete('popup')
    closed.page.emit('close')
    expect(closed.access.closeTab).not.toHaveBeenCalled()

    const expected = fixture()
    expected.expectedTabClosures.add(expected.page)
    expected.page.emit('close')
    expect(expected.access.closeTab).not.toHaveBeenCalled()

    const quitting = fixture()
    quitting.closeBrowser()
    quitting.page.emit('close')
    expect(quitting.access.closeTab).not.toHaveBeenCalled()
  })

  it('says the page is gone when its tab cannot close, unless another close closed it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const stuck = fixture({ closeTab: async () => { throw new Error('Could not wake the next tab') } })
      stuck.page.emit('close')
      await vi.waitFor(() => expect(stuck.access.recoverDestroyedPage).toHaveBeenCalledWith(stuck.tab))

      const closedMeanwhile = fixture({ closeTab: async () => { throw new Error('Unknown tab') } })
      closedMeanwhile.page.emit('close')
      closedMeanwhile.tabs.delete('popup')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(closedMeanwhile.access.recoverDestroyedPage).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})
