import { afterEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

async function hronautApi() {
  await import('../src/preload/index.js')
  return electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronaut')?.[1] as {
    showHistoryMenu: (options: unknown) => Promise<void>
    onVisitHistoryRequested: (listener: (...args: unknown[]) => void) => () => void
  }
}

it('asks for the list of pages an arrow goes through', async () => {
  const api = await hronautApi()
  const options = { tabId: 'tab-1', direction: 'back', anchor: { x: 12, y: 72 } }
  void api.showHistoryMenu(options)
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('browser:show-history-menu', options)
})

it('passes on Show Full History without anything the sender adds, and stops listening when asked', async () => {
  const api = await hronautApi()
  const listener = vi.fn()
  const stop = api.onVisitHistoryRequested(listener)
  const [, handler] = electron.on.mock.calls.find(([channel]) => channel === 'browser:visit-history-requested')!
  handler({ sender: 'event' }, 'extra')
  expect(listener.mock.calls).toEqual([[]])
  stop()
  expect(electron.removeListener).toHaveBeenCalledWith('browser:visit-history-requested', handler)
})

it('passes on Paste and Go\'s text only when it is text, and stops listening when asked', async () => {
  const api = (await hronautApi()) as unknown as { onAddressPasteAndGo: (listener: (...args: unknown[]) => void) => () => void }
  const listener = vi.fn()
  const stop = api.onAddressPasteAndGo(listener)
  const [, handler] = electron.on.mock.calls.find(([channel]) => channel === 'browser:address-paste-and-go')!
  handler({ sender: 'event' }, 'example.com', 'extra')
  handler({ sender: 'event' }, { url: 'example.com' })
  expect(listener.mock.calls).toEqual([['example.com']])
  stop()
  expect(electron.removeListener).toHaveBeenCalledWith('browser:address-paste-and-go', handler)
})
