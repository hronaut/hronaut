import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => []),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
    send: electron.send
  }
}))

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('tab overview preload bridge', () => {
  it('forwards only requested tab IDs through the trusted shell API', async () => {
    await import('../src/preload/index.js')
    const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronaut')?.[1] as {
      getTabOverviewPreviews?: (tabIds: string[]) => Promise<unknown>
    } | undefined

    await api?.getTabOverviewPreviews?.(['tab-1', 'tab-2'])

    expect(electron.invoke).toHaveBeenCalledWith('browser:get-tab-overview-previews', ['tab-1', 'tab-2'])
  })
})
