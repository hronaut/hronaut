import { afterEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

it('passes on only a workspace id string from a menu\'s New Tab request, and stops listening when asked', async () => {
  await import('../src/preload/index.js')
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronaut')?.[1] as {
    onNewTabRequested: (listener: (workspaceId: string | undefined) => void) => () => void
  }
  const listener = vi.fn()
  const stop = api.onNewTabRequested(listener)
  const [, handler] = electron.on.mock.calls.find(([channel]) => channel === 'browser:new-tab-requested')!
  handler({ sender: 'event' }, 'workspace-1')
  handler({ sender: 'event' }, { id: 'workspace-1' })
  handler({ sender: 'event' }, 7)
  handler({ sender: 'event' })
  expect(listener.mock.calls).toEqual([['workspace-1'], [undefined], [undefined], [undefined]])
  stop()
  expect(electron.removeListener).toHaveBeenCalledWith('browser:new-tab-requested', handler)
})
