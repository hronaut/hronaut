import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

function consoleHandler() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const showDevToolsConsole = vi.fn(async () => true)
  const assertTrustedSender = vi.fn()
  registerNavigationIpc({
    assertTrustedSender,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ showDevToolsConsole }) as never,
    defaultPdfPageSize: () => 'A4'
  })
  const handler = handlers.get('browser:show-devtools-console')!
  return { show: (tabId?: unknown) => handler({} as IpcMainInvokeEvent, tabId), showDevToolsConsole, assertTrustedSender }
}

describe('opening Developer Tools on the Console from Hronaut\'s window', () => {
  it('passes the tab, or none for the tab in view, from Hronaut\'s own window only', async () => {
    const { show, showDevToolsConsole, assertTrustedSender } = consoleHandler()
    await expect(show('tab-1')).resolves.toBe(true)
    await expect(show()).resolves.toBe(true)
    expect(assertTrustedSender).toHaveBeenCalledTimes(2)
    expect(showDevToolsConsole.mock.calls).toEqual([['tab-1'], [undefined]])
  })

  it('refuses a sender other than Hronaut\'s window, and a tab that is not a tab ID', () => {
    const { show, showDevToolsConsole, assertTrustedSender } = consoleHandler()
    assertTrustedSender.mockImplementationOnce(() => { throw new Error('Untrusted sender') })
    expect(() => show('tab-1')).toThrow('Untrusted sender')
    for (const tabId of [null, 1, { id: 'tab-1' }]) expect(() => show(tabId), JSON.stringify(tabId)).toThrow('Invalid tab ID')
    expect(showDevToolsConsole).not.toHaveBeenCalled()
  })

  it('is asked for by the preload with the tab as given', async () => {
    await import('../src/preload/index.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronaut')?.[1] as {
      showDevToolsConsole: (tabId?: string) => Promise<boolean>
    }
    void api.showDevToolsConsole('tab-1')
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('browser:show-devtools-console', 'tab-1')
  })
})
