import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'

vi.mock('electron', () => ({}))
// The handler searches with the browser; that runs on the fake browser's stub.
vi.mock('../src/main/browser/page-find/page-find.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/page-find/page-find.js')>(),
  findInPage: (browser: { findInPage: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.findInPage(...args)
}))
afterEach(() => { vi.clearAllMocks() })

function findHandler() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const findInPage = vi.fn()
  const assertTrustedSender = vi.fn()
  registerNavigationIpc({
    assertTrustedSender,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ findInPage }) as never,
    defaultPdfPageSize: () => 'A4'
  })
  const handler = handlers.get('browser:find-in-page')!
  return { find: (...args: unknown[]) => handler({} as IpcMainInvokeEvent, ...args), findInPage, assertTrustedSender }
}

describe('searching a page from Hronaut\'s find bar', () => {
  it('passes the query and options, and whether to search from the start of the selection, from Hronaut\'s own window only', () => {
    const { find, findInPage, assertTrustedSender } = findHandler()
    find({ tabId: 'tab-1', query: 'needle', findNext: true })
    find({ tabId: 'tab-1', query: 'needle', forward: true, findNext: true, caseSensitive: false, fromSelectionStart: true })
    expect(assertTrustedSender).toHaveBeenCalledTimes(2)
    expect(findInPage.mock.calls).toEqual([
      ['needle', { tabId: 'tab-1', forward: undefined, findNext: true, caseSensitive: undefined, fromSelectionStart: undefined }],
      ['needle', { tabId: 'tab-1', forward: true, findNext: true, caseSensitive: false, fromSelectionStart: true }]
    ])
  })

  it('refuses options whose fromSelectionStart is not true or false', () => {
    const { find, findInPage } = findHandler()
    for (const fromSelectionStart of ['yes', 1, null]) {
      expect(() => find({ query: 'needle', fromSelectionStart }), String(fromSelectionStart)).toThrow('Invalid find options')
    }
    expect(findInPage).not.toHaveBeenCalled()
  })
})
