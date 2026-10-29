import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNavigationIpc } from '../src/main/navigation-ipc.js'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

function proceedHandler() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const state = { tabs: [] }
  const proceedPastCertificateError = vi.fn(async () => state)
  const beforeStateReply = vi.fn()
  const assertTrustedSender = vi.fn((event: IpcMainInvokeEvent) => {
    if ((event as unknown as { untrusted?: boolean }).untrusted) throw new Error('Untrusted sender')
  })
  registerNavigationIpc({
    assertTrustedSender,
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ proceedPastCertificateError, beforeStateReply }) as never,
    defaultPdfPageSize: () => 'A4'
  })
  const handler = handlers.get('browser:proceed-past-certificate')!
  const proceed = (event: object, ...args: unknown[]) => handler(event as IpcMainInvokeEvent, ...args)
  return { proceed, proceedPastCertificateError, beforeStateReply, assertTrustedSender, state }
}

describe('opening a page anyway after its certificate was refused', () => {
  it('is asked for only by Hronaut’s own window, for a tab, and answers with the state', async () => {
    const { proceed, proceedPastCertificateError, beforeStateReply, state } = proceedHandler()
    await expect(proceed({}, 'tab-1')).resolves.toBe(state)
    expect(proceedPastCertificateError).toHaveBeenCalledExactlyOnceWith('tab-1')
    expect(beforeStateReply).toHaveBeenCalledOnce()
    expect(() => proceed({ untrusted: true }, 'tab-1')).toThrow('Untrusted sender')
    for (const tabId of [undefined, 1, { id: 'tab-1' }]) expect(() => proceed({}, tabId), JSON.stringify(tabId)).toThrow('Invalid tab')
    expect(proceedPastCertificateError).toHaveBeenCalledOnce()
  })

  it('is asked for by the preload with the tab', async () => {
    await import('../src/preload/index.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronaut')?.[1] as {
      proceedPastCertificateError: (tabId: string) => Promise<unknown>
    }
    void api.proceedPastCertificateError('tab-1')
    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('browser:proceed-past-certificate', 'tab-1')
  })
})
