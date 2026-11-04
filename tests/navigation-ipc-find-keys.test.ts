import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'

vi.mock('electron', () => ({}))
// The handler sends the key with the browser; that runs on the fake browser's stub.
vi.mock('../src/main/browser/page-find/find-page-keys.js', () => ({
  forwardFindKeyToPage: (browser: { forwardFindKeyToPage: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.forwardFindKeyToPage(...args)
}))
afterEach(() => { vi.clearAllMocks() })

function keyHandler() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const forwardFindKeyToPage = vi.fn()
  const assertTrustedSender = vi.fn()
  registerNavigationIpc({
    assertTrustedSender,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ forwardFindKeyToPage }) as never,
    defaultPdfPageSize: () => 'A4'
  })
  const handler = handlers.get('browser:forward-find-key')!
  return { send: (...args: unknown[]) => handler({} as IpcMainInvokeEvent, ...args), forwardFindKeyToPage, assertTrustedSender }
}

const key = (overrides: Record<string, unknown> = {}) => ({
  type: 'keyDown', key: 'ArrowDown', shift: false, control: false, alt: false, meta: false, repeat: false, ...overrides
})

describe('a key from Hronaut\'s Find field for the page', () => {
  it('passes the tab and only the key\'s own fields, from Hronaut\'s own window only', () => {
    const { send, forwardFindKeyToPage, assertTrustedSender } = keyHandler()
    send('tab-1', key())
    send('tab-1', key({ type: 'keyUp', key: 'End', control: true, shift: true, repeat: true, extra: 'ignored' }))
    expect(assertTrustedSender).toHaveBeenCalledTimes(2)
    expect(forwardFindKeyToPage.mock.calls).toEqual([
      ['tab-1', key()],
      ['tab-1', key({ type: 'keyUp', key: 'End', control: true, shift: true, repeat: true })]
    ])
  })

  it('refuses any other key, Home and End without Ctrl, and fields that are not true or false', () => {
    const { send, forwardFindKeyToPage } = keyHandler()
    for (const value of [
      null, 'ArrowDown', key({ type: 'char' }), key({ key: 'Enter' }), key({ key: 'a' }), key({ key: 'Home' }), key({ key: 'End', control: 1 }),
      key({ shift: 'yes' }), key({ repeat: undefined }), key({ meta: null })
    ]) {
      expect(() => send('tab-1', value), JSON.stringify(value)).toThrow('Invalid find key')
    }
    expect(() => send(undefined, key())).toThrow('Invalid find tab')
    expect(() => send(1, key())).toThrow('Invalid find tab')
    expect(forwardFindKeyToPage).not.toHaveBeenCalled()
  })
})
