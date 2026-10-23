import { afterEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
const argv = [...process.argv]
afterEach(() => {
  process.argv.splice(0, process.argv.length, ...argv)
  vi.resetModules()
  vi.clearAllMocks()
})

const exposed = (): string[] => electron.exposeInMainWorld.mock.calls.map(([name]) => name as string)

it('gives only the main window\'s shell the channel that opens its tab rail over the page', async () => {
  // A detached panel's window loads the same preload, and has no tab rail.
  await import('../src/preload/index.js')
  expect(exposed()).toContain('hronaut')
  expect(exposed()).not.toContain('hronautSidebarOverlay')
  vi.resetModules()
  electron.exposeInMainWorld.mockClear()
  process.argv.push('--hronaut-window-kind=main')
  await import('../src/preload/index.js')
  expect(exposed()).toContain('hronautSidebarOverlay')
})
