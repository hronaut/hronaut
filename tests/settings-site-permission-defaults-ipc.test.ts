import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../src/shared/types.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeTheme: {} }))
// The fake browser below stands in for the tabs; this reaches its stub.
vi.mock('../src/main/browser/site-muting/site-muting.js', () => ({
  applySiteMutingToTabs: (browser: { applySiteMutingToTabs: () => void }) => browser.applySiteMutingToTabs()
}))

const { registerSettingsIpc } = await import('../src/main/settings/settings-ipc.js')
const { DEFAULT_SETTINGS } = await import('../src/main/settings/settings-store.js')

// Settings → Site permissions → Defaults saves the permissions blocked, or Sound muted, for every website.

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function settingsIpc(withTabs = true) {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) }, on: () => ipcMain } as unknown as IpcMain
  let settings: AppSettings = { ...DEFAULT_SETTINGS }
  const tabs = { applySiteMutingToTabs: vi.fn() }
  const host = {
    assertTrustedSender: vi.fn(),
    handleBrowserIpc: (channel: string, handler: Handler) => { handlers.set(channel, handler) },
    tabs: () => withTabs ? tabs : null,
    settings: () => settings,
    updateSettings: vi.fn(async (patch: Partial<AppSettings>) => { settings = { ...settings, ...patch } }),
    publishSettings: vi.fn()
  }
  registerSettingsIpc(ipcMain, host as never)
  const invoke = (...args: unknown[]) => Promise.resolve().then(() => (
    handlers.get('settings:set-site-permissions-blocked-by-default')!({} as IpcMainInvokeEvent, ...args)
  ))
  return { invoke, host, tabs, settings: () => settings }
}

describe('default site permissions in Settings', () => {
  it('saves them in the order Settings lists them, applies Sound to open tabs and tells every window', async () => {
    const { invoke, host, tabs, settings } = settingsIpc()
    const answer = await invoke(['sound', 'notifications', 'geolocation'])

    expect(settings().sitePermissionsBlockedByDefault).toEqual(['geolocation', 'notifications', 'sound'])
    expect(answer).toEqual(settings())
    expect(host.assertTrustedSender).toHaveBeenCalledOnce()
    expect(tabs.applySiteMutingToTabs).toHaveBeenCalledOnce()
    expect(host.publishSettings).toHaveBeenCalledOnce()

    await invoke([])
    expect(settings().sitePermissionsBlockedByDefault).toEqual([])
  })

  it.each([
    ['a name', 'camera'],
    ['a permission Settings does not list', ['fullscreen']],
    ['the same permission twice', ['camera', 'camera']],
    ['a value that is not a name', [42]]
  ])('refuses %s and changes nothing', async (_case, value) => {
    const { invoke, host, tabs, settings } = settingsIpc()
    await expect(invoke(value)).rejects.toThrow('Invalid default site permissions')
    expect(settings().sitePermissionsBlockedByDefault).toEqual([])
    expect(host.updateSettings).not.toHaveBeenCalled()
    expect(tabs.applySiteMutingToTabs).not.toHaveBeenCalled()
  })

  it('saves them before the tabs have opened', async () => {
    const { invoke, settings } = settingsIpc(false)
    await invoke(['camera'])
    expect(settings().sitePermissionsBlockedByDefault).toEqual(['camera'])
  })
})
