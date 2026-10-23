import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

function newTabHandler() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const openNavigationInNewTab = vi.fn(async () => ({ tabs: [] }))
  const assertTrustedSender = vi.fn()
  registerNavigationIpc({
    assertTrustedSender,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ openNavigationInNewTab }) as never,
    defaultPdfPageSize: () => 'A4'
  })
  const handler = handlers.get('browser:open-navigation-in-new-tab')!
  return { open: (options: unknown) => handler({} as IpcMainInvokeEvent, options), openNavigationInNewTab, assertTrustedSender }
}

describe('opening the page of Back, Forward or Reload in a new tab from Hronaut\'s toolbar', () => {
  it('passes the tab, the button and whether the tab opens in front, from Hronaut\'s own window only', async () => {
    const { open, openNavigationInNewTab, assertTrustedSender } = newTabHandler()
    await open({ tabId: 'tab-1', target: 'back', active: false })
    await open({ tabId: 'tab-1', target: 'reload', active: true })
    expect(assertTrustedSender).toHaveBeenCalledTimes(2)
    expect(openNavigationInNewTab.mock.calls).toEqual([['tab-1', 'back', false], ['tab-1', 'reload', true]])
  })

  it('refuses anything else', () => {
    const { open, openNavigationInNewTab } = newTabHandler()
    for (const options of [undefined, null, 'back', { tabId: 1, target: 'back', active: false }, { tabId: 'tab-1', target: 'home', active: false },
      { tabId: 'tab-1', target: 'back' }, { tabId: 'tab-1', target: 'forward', active: 'yes' }]) {
      expect(() => open(options), JSON.stringify(options)).toThrow('Invalid new tab options')
    }
    expect(openNavigationInNewTab).not.toHaveBeenCalled()
  })

  it('is asked for by the preload with the options as given', async () => {
    await import('../src/preload/index.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronaut')?.[1] as {
      openNavigationInNewTab: (options: unknown) => Promise<unknown>
    }
    const options = { tabId: 'tab-1', target: 'forward', active: true }
    void api.openNavigationInNewTab(options)
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('browser:open-navigation-in-new-tab', options)
  })
})
