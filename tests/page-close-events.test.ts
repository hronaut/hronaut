import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
// The browser below stubs recoverFromDestroyedPage, which a tab that could not close shows its page's problem with.
vi.mock('../src/main/browser/tab-events/page-destroyed-events.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-events/page-destroyed-events.js')>(),
  recoverFromDestroyedPage: (browser: { recoverFromDestroyedPage: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.recoverFromDestroyedPage(...args)
}))
import { attachPageCloseEvents } from '../src/main/browser/tab-events/page-close-events.js'

// A sign-in popup that closed itself with window.close() left a tab saying its page was no longer available.

function fixture(options: { closeTab?: () => Promise<never> } = {}) {
  const tab = { id: 'popup' }
  const page = new EventEmitter() as EventEmitter & WebContents
  const tabs = new Map([[tab.id, tab]])
  const expectedTabClosures = new WeakSet<WebContents>()
  const browser = {
    destroyed: false,
    tabs,
    expectedTabClosures,
    closeTab: vi.fn(options.closeTab ?? (async () => ({}) as never)),
    recoverFromDestroyedPage: vi.fn()
  }
  attachPageCloseEvents(browser as never, tab as never, page)
  return { tab, page, tabs, expectedTabClosures, browser, closeBrowser: () => { browser.destroyed = true } }
}

describe('a page opened for a window that closes itself', () => {
  it('closes its tab, and its destruction shows no problem', () => {
    const { page, browser, expectedTabClosures } = fixture()
    page.emit('close')
    expect(browser.closeTab).toHaveBeenCalledWith('popup')
    expect(expectedTabClosures.has(page)).toBe(true)
    page.emit('close')
    expect(browser.closeTab).toHaveBeenCalledTimes(1)
  })

  it('leaves a close Hronaut makes itself alone', () => {
    const closed = fixture()
    closed.tabs.delete('popup')
    closed.page.emit('close')
    expect(closed.browser.closeTab).not.toHaveBeenCalled()

    const expected = fixture()
    expected.expectedTabClosures.add(expected.page)
    expected.page.emit('close')
    expect(expected.browser.closeTab).not.toHaveBeenCalled()

    const quitting = fixture()
    quitting.closeBrowser()
    quitting.page.emit('close')
    expect(quitting.browser.closeTab).not.toHaveBeenCalled()
  })

  it('says the page is gone when its tab cannot close, unless another close closed it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const stuck = fixture({ closeTab: async () => { throw new Error('Could not wake the next tab') } })
      stuck.page.emit('close')
      await vi.waitFor(() => expect(stuck.browser.recoverFromDestroyedPage).toHaveBeenCalledWith(stuck.tab))

      const closedMeanwhile = fixture({ closeTab: async () => { throw new Error('Unknown tab') } })
      closedMeanwhile.page.emit('close')
      closedMeanwhile.tabs.delete('popup')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(closedMeanwhile.browser.recoverFromDestroyedPage).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})
