import { afterEach, expect, it, vi } from 'vitest'

/** The tray icons Hronaut created, in order, and the watch for the desktop's tray. */
const { trays, failing, watchStatusNotifierWatcher } = vi.hoisted(() => ({
  trays: [] as Array<{ destroyed: boolean; image: unknown; setImage: (image: unknown) => void }>,
  failing: { tray: false },
  watchStatusNotifierWatcher: vi.fn<(onTrayStarted: () => void) => () => void>(() => () => undefined)
}))
vi.mock('electron', () => ({
  Tray: class {
    destroyed = false
    image: unknown
    readonly setToolTip = vi.fn()
    readonly setContextMenu = vi.fn()
    readonly on = vi.fn()
    readonly popUpContextMenu = vi.fn()
    constructor(image: unknown) {
      if (failing.tray) throw new Error('No tray')
      this.image = image
      trays.push(this)
    }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
    setImage(image: unknown) { this.image = image }
  },
  Menu: { buildFromTemplate: (template: unknown) => ({ template }) },
  nativeImage: { createFromPath: (path: string) => ({ path, isEmpty: () => false, resize() { return this } }) },
  Notification: class {}
}))
vi.mock('../build/icons/24x24.png?asset', () => ({ default: '/icons/tray.png' }))
vi.mock('../build/icons/tray-attention.png?asset', () => ({ default: '/icons/tray-attention.png' }))
vi.mock('../src/main/attention/status-notifier-watcher.js', () => ({ watchStatusNotifierWatcher }))
const { createTrayAttention } = await import('../src/main/attention/tray-attention.js')

const platform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
  trays.length = 0
  failing.tray = false
  watchStatusNotifierWatcher.mockClear()
})

function trayAttention() {
  const showWindow = vi.fn()
  const host = {
    text: (key: string) => key, showWindow, mainWindow: () => null, tabs: () => null, mcpServer: () => null,
    runNativeBrowserAction: vi.fn(), checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    userAttentionLifecycle: { acknowledge: vi.fn(), reconcile: vi.fn(), request: vi.fn(), supersede: vi.fn() },
    state: { request: null, quiet: false, decisionId: undefined },
    agentPresenceSnapshot: vi.fn(), scheduleAgentPresencePublish: vi.fn(),
    settings: () => ({ hideInTray: false }), setSettings: vi.fn(), publishSettings: vi.fn(), updateSettings: vi.fn()
  }
  return { attention: createTrayAttention(host as never), showWindow }
}

it('creates the tray icon again on Linux each time the desktop’s tray starts', () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  const { attention, showWindow } = trayAttention()
  expect(attention.createTray()).toBe(true)
  expect(attention.createTray()).toBe(true)
  expect(watchStatusNotifierWatcher).toHaveBeenCalledOnce()
  const trayStarted = watchStatusNotifierWatcher.mock.calls[0]![0]
  trayStarted()
  expect(trays.map((tray) => tray.destroyed)).toEqual([true, false])
  expect(trays[1]).toMatchObject({ image: { path: '/icons/tray.png' } })
  trayStarted()
  expect(trays.map((tray) => tray.destroyed)).toEqual([true, true, false])
  expect(watchStatusNotifierWatcher).toHaveBeenCalledOnce()
  expect(showWindow).not.toHaveBeenCalled()
})

it('follows the desktop’s tray only on Linux', () => {
  for (const other of ['darwin', 'win32']) {
    Object.defineProperty(process, 'platform', { value: other })
    expect(trayAttention().attention.createTray()).toBe(true)
  }
  expect(watchStatusNotifierWatcher).not.toHaveBeenCalled()
})

it('opens the window when the icon cannot be created again, since nothing else would open it', () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  const { attention, showWindow } = trayAttention()
  attention.createTray()
  failing.tray = true
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  watchStatusNotifierWatcher.mock.calls[0]![0]()
  expect(trays.map((tray) => tray.destroyed)).toEqual([true])
  expect(showWindow).toHaveBeenCalledOnce()
  vi.mocked(console.error).mockRestore()
})
