import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'

vi.mock('electron', () => ({}))
// The handler reads the selected text with the browser; that runs on the fake browser's stub.
vi.mock('../src/main/browser/page-find/find-selection-text.js', () => ({
  findSelectionText: (browser: { findSelectionText: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.findSelectionText(...args)
}))
afterEach(() => { vi.clearAllMocks() })

function selectionHandler() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const findSelectionText = vi.fn(async () => 'needle')
  const assertTrustedSender = vi.fn()
  registerNavigationIpc({
    assertTrustedSender,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ findSelectionText }) as never,
    defaultPdfPageSize: () => 'A4'
  })
  const handler = handlers.get('browser:find-selection-text')!
  return { send: (...args: unknown[]) => handler({} as IpcMainInvokeEvent, ...args), findSelectionText, assertTrustedSender }
}

describe('the text selected in a page, for Hronaut\'s Find field', () => {
  it('is read for the tab, for Hronaut\'s own window only', async () => {
    const { send, findSelectionText, assertTrustedSender } = selectionHandler()
    await expect(send('tab-1')).resolves.toBe('needle')
    expect(assertTrustedSender).toHaveBeenCalledOnce()
    expect(findSelectionText).toHaveBeenCalledExactlyOnceWith('tab-1')
  })

  it('is refused without a tab', () => {
    const { send, findSelectionText } = selectionHandler()
    expect(() => send(undefined)).toThrow('Invalid find tab')
    expect(() => send(1)).toThrow('Invalid find tab')
    expect(findSelectionText).not.toHaveBeenCalled()
  })
})
