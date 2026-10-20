import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerPageInspectionIpc } from '../src/main/page-inspection-ipc.js'

function manageStorageHandler() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const manageStorage = vi.fn(async () => ({}))
  registerPageInspectionIpc({
    assertTrustedSender: () => undefined,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ manageStorage }) as never,
    copyTextToClipboard: async () => undefined,
    copyPngToClipboard: async () => ({ width: 0, height: 0 })
  })
  const handler = handlers.get('browser:manage-storage')!
  return { manageStorage, call: (value: unknown) => handler({} as IpcMainInvokeEvent, value) }
}

describe('site storage IPC', () => {
  it('passes the domain and path of the cookie row Site storage deletes', async () => {
    const { manageStorage, call } = manageStorageHandler()
    await call({ tabId: 'tab-1', kind: 'cookies', action: 'delete', key: 'pref', cookieDomain: '.example.test', cookiePath: '/app', includeValues: true })
    expect(manageStorage).toHaveBeenCalledExactlyOnceWith({
      tabId: 'tab-1', kind: 'cookies', action: 'delete', key: 'pref', value: undefined, includeValues: true, cookieDomain: '.example.test', cookiePath: '/app'
    })
  })

  it.each([{ cookieDomain: 1, cookiePath: '/' }, { cookieDomain: 'example.test', cookiePath: ['/'] }])('rejects a cookie domain or path that is not text: %j', selector => {
    const { manageStorage, call } = manageStorageHandler()
    expect(() => call({ kind: 'cookies', action: 'delete', key: 'pref', ...selector })).toThrow('Invalid site storage request')
    expect(manageStorage).not.toHaveBeenCalled()
  })
})
