import { afterEach, expect, it, vi } from 'vitest'

// Main asks a Bookmarks window it has just opened for Bookmark all tabs' name once the window has loaded. The shell
// reads its settings before it mounts and listens, so the request was lost and nothing asked for the name.

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

it('keeps a Bookmark all tabs request that comes before the shell listens, and passes on only a workspace id or none', async () => {
  await import('../src/preload/index.js')
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronaut')?.[1] as {
    onBookmarkAllTabsRequested: (listener: (workspaceId: string | null) => void) => () => void
  }
  const [, handler] = electron.on.mock.calls.find(([channel]) => channel === 'browser:bookmark-all-tabs-requested')!
  handler({ sender: 'event' }, 'client')
  const listener = vi.fn()
  const stop = api.onBookmarkAllTabsRequested(listener)
  expect(listener.mock.calls).toEqual([['client']])
  handler({ sender: 'event' }, { id: 'client' })
  handler({ sender: 'event' }, null)
  expect(listener.mock.calls).toEqual([['client'], [null], [null]])
  stop()
  handler({ sender: 'event' }, 'later')
  expect(listener).toHaveBeenCalledTimes(3)
})
