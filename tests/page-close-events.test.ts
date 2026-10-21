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
  const onActionFailed = vi.fn()
  let destroyed = false
  const access: PageCloseEventsAccess<PageCloseEventsTab> = {
    isDestroyed: () => destroyed,
    findTab: (tabId) => tabs.get(tabId),
    expectedTabClosures: () => expectedTabClosures,
    closeTab: vi.fn(options.closeTab ?? (async () => ({}) as never)),
    options: () => ({ onActionFailed })
  }
  attachPageCloseEvents(access, tab, page)
  return { page, tabs, expectedTabClosures, access, onActionFailed, closeBrowser: () => { destroyed = true } }
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

  it('reports a tab it could not close', async () => {
    const { page, onActionFailed } = fixture({ closeTab: async () => { throw new Error('Tab busy') } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      page.emit('close')
      await vi.waitFor(() => expect(onActionFailed).toHaveBeenCalledWith('close tab', expect.objectContaining({ message: 'Tab busy' })))
    } finally {
      consoleError.mockRestore()
    }
  })
})
