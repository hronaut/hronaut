import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

function stopFindHandler() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const stopFindInPage = vi.fn()
  const assertTrustedSender = vi.fn()
  registerNavigationIpc({
    assertTrustedSender,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ stopFindInPage }) as never,
    defaultPdfPageSize: () => 'A4'
  })
  const handler = handlers.get('browser:stop-find-in-page')!
  return { stop: (...args: unknown[]) => handler({} as IpcMainInvokeEvent, ...args), stopFindInPage, assertTrustedSender }
}

describe('ending a page search from Hronaut\'s find bar', () => {
  it('passes the tab and whether to click the active match, from Hronaut\'s own window only', () => {
    const { stop, stopFindInPage, assertTrustedSender } = stopFindHandler()
    stop('tab-1')
    stop('tab-1', { activateMatch: true })
    stop(undefined, { activateMatch: false })
    expect(assertTrustedSender).toHaveBeenCalledTimes(3)
    expect(stopFindInPage.mock.calls).toEqual([
      ['tab-1', { activateMatch: undefined }],
      ['tab-1', { activateMatch: true }],
      [undefined, { activateMatch: false }]
    ])
  })

  it('refuses options that are not an object with a true-or-false activateMatch', () => {
    const { stop, stopFindInPage } = stopFindHandler()
    for (const options of [null, 'activate', 1, { activateMatch: 'yes' }, { activateMatch: 1 }]) {
      expect(() => stop('tab-1', options), JSON.stringify(options)).toThrow('Invalid stop find options')
    }
    expect(() => stop(1, { activateMatch: true })).toThrow('Invalid find tab')
    expect(stopFindInPage).not.toHaveBeenCalled()
  })

  it('is asked for by the preload with the tab and options as given', async () => {
    await import('../src/preload/index.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronaut')?.[1] as {
      stopFindInPage: (tabId?: string, options?: { activateMatch?: boolean }) => Promise<void>
    }
    void api.stopFindInPage('tab-1', { activateMatch: true })
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('browser:stop-find-in-page', 'tab-1', { activateMatch: true })
  })
})
