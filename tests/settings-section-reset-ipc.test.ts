import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../src/shared/types.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeTheme: {} }))

const { registerSettingsIpc } = await import('../src/main/settings-ipc.js')
const { DEFAULT_SETTINGS } = await import('../src/main/settings-store.js')

// Reset to default in Appearance also set back the language, startup and tray, and agent activity rows, which moved to
// General; each section's reset now sets back only the settings it shows.

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const CHANGED: Partial<AppSettings> = {
  theme: 'matrix',
  interfaceScale: 1.25,
  tabPosition: 'top',
  useSystemTitleBar: true,
  hideInTray: false,
  launchAtStartup: true,
  launchMinimized: true,
  attentionSound: false,
  attentionSoundCue: 'bell',
  showAgentCursor: false,
  pinAgentLiveStatus: true,
  languagePreference: 'uk-UA',
  searchEngine: 'bing',
  memorySaverEnabled: false,
  memorySaverTimeoutMinutes: 15,
  graphicsAcceleration: false
}
const APPEARANCE_KEYS = ['theme', 'interfaceScale', 'tabPosition', 'useSystemTitleBar'] as const
const GENERAL_KEYS = [
  'hideInTray', 'launchAtStartup', 'launchMinimized', 'attentionSound', 'attentionSoundCue',
  'showAgentCursor', 'pinAgentLiveStatus', 'languagePreference'
] as const
const PERFORMANCE_KEYS = ['memorySaverEnabled', 'memorySaverTimeoutMinutes', 'graphicsAcceleration'] as const

function settingsIpc(packaged = false) {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) }, on: () => ipcMain } as unknown as IpcMain
  let settings: AppSettings = { ...DEFAULT_SETTINGS, ...CHANGED }
  const startupLaunchManager = { setEnabled: vi.fn(async () => undefined) }
  const setMemorySaverSettings = vi.fn()
  const host = {
    assertTrustedSender: vi.fn(),
    handleBrowserIpc: (channel: string, handler: Handler) => { handlers.set(channel, handler) },
    tabs: () => ({ setMemorySaverSettings }),
    isPackaged: () => packaged,
    startupLaunchManager: () => startupLaunchManager,
    settings: () => settings,
    updateSettings: vi.fn(async (patch: Partial<AppSettings>, apply?: (next: AppSettings) => Promise<void>) => {
      const next = { ...settings, ...patch }
      await apply?.(next)
      settings = next
    }),
    applyTheme: vi.fn(),
    applyInterfaceScale: vi.fn(),
    applyLanguagePreferenceRuntime: vi.fn(async () => { host.publishSettings() }),
    publishSettings: vi.fn(),
    currentRendererSettingsState: () => ({ settings })
  }
  registerSettingsIpc(ipcMain, host as never)
  const invoke = (channel: string) => Promise.resolve().then(() => handlers.get(channel)!({} as IpcMainInvokeEvent))
  return { invoke, host, startupLaunchManager, setMemorySaverSettings, settings: () => settings }
}

const pick = (settings: AppSettings, keys: readonly (keyof AppSettings)[]) => Object.fromEntries(keys.map(key => [key, settings[key]]))

describe('Reset to default in Settings', () => {
  it('sets back only the Appearance settings and tells every window once', async () => {
    const { invoke, host, settings } = settingsIpc()
    await invoke('settings:reset-appearance')

    expect(pick(settings(), APPEARANCE_KEYS)).toEqual(pick(DEFAULT_SETTINGS, APPEARANCE_KEYS))
    expect(pick(settings(), GENERAL_KEYS)).toEqual(pick({ ...DEFAULT_SETTINGS, ...CHANGED }, GENERAL_KEYS))
    expect(settings().searchEngine).toBe('bing')
    expect(host.applyTheme).toHaveBeenCalledWith(DEFAULT_SETTINGS.theme)
    expect(host.applyInterfaceScale).toHaveBeenCalledWith(DEFAULT_SETTINGS.interfaceScale)
    expect(host.applyLanguagePreferenceRuntime).not.toHaveBeenCalled()
    expect(host.publishSettings).toHaveBeenCalledOnce()
  })

  it('sets back only the General settings, applies the language and tells every window once', async () => {
    const { invoke, host, settings, startupLaunchManager } = settingsIpc(true)
    await invoke('settings:reset-general')

    expect(pick(settings(), GENERAL_KEYS)).toEqual(pick(DEFAULT_SETTINGS, GENERAL_KEYS))
    expect(pick(settings(), APPEARANCE_KEYS)).toEqual(pick({ ...DEFAULT_SETTINGS, ...CHANGED }, APPEARANCE_KEYS))
    expect(settings().searchEngine).toBe('bing')
    expect(startupLaunchManager.setEnabled).toHaveBeenCalledWith(DEFAULT_SETTINGS.launchAtStartup)
    expect(host.applyLanguagePreferenceRuntime).toHaveBeenCalledWith(DEFAULT_SETTINGS.languagePreference)
    expect(host.applyTheme).not.toHaveBeenCalled()
    expect(host.publishSettings).toHaveBeenCalledOnce()
  })

  it('resets Appearance in a packaged build without the startup integration, which only General needs', async () => {
    const { invoke, host, settings } = settingsIpc(true)
    host.startupLaunchManager = () => null as never
    await invoke('settings:reset-appearance')
    expect(settings().theme).toBe(DEFAULT_SETTINGS.theme)
    await expect(invoke('settings:reset-general')).rejects.toThrow()
    expect(settings().languagePreference).toBe('uk-UA')
  })

  it('sets back Memory Saver and graphics acceleration in Performance, which applies at the next start', async () => {
    const { invoke, host, settings, setMemorySaverSettings } = settingsIpc()
    await invoke('settings:reset-memory-saver')

    expect(pick(settings(), PERFORMANCE_KEYS)).toEqual(pick(DEFAULT_SETTINGS, PERFORMANCE_KEYS))
    expect(settings().graphicsAcceleration).toBe(true)
    expect(pick(settings(), GENERAL_KEYS)).toEqual(pick({ ...DEFAULT_SETTINGS, ...CHANGED }, GENERAL_KEYS))
    expect(setMemorySaverSettings).toHaveBeenCalledWith(true, DEFAULT_SETTINGS.memorySaverTimeoutMinutes)
    expect(host.publishSettings).toHaveBeenCalledOnce()
  })
})
