import { afterEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

it('exposes an explicit single-tab page preview through the trusted shell bridge', async () => {
  await import('../src/preload/index.js')
  const api = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronaut')?.[1] as {
    getTabOverviewPagePreview?: (tabId: string) => Promise<unknown>
  }
  expect(api.getTabOverviewPagePreview).toBeTypeOf('function')
  await api.getTabOverviewPagePreview?.('tab-1')
  expect(electron.invoke).toHaveBeenCalledWith('browser:get-tab-overview-page-preview', 'tab-1')
})
