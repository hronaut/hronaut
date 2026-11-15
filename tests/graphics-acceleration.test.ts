import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../src/shared/types.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeTheme: {} }))

const { applySavedGraphicsAcceleration, readSavedGraphicsAcceleration, registerGraphicsAccelerationIpc } =
  await import('../src/main/graphics-acceleration.js')
const { DEFAULT_SETTINGS, SettingsStore } = await import('../src/main/settings/settings-store.js')

// Hronaut always drew with the graphics card, with no way to turn that off when a driver left windows black or blank.
// As in Chrome's Use graphics acceleration when available, the saved setting is read before Electron is ready, and a
// change applies at the next start.

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

let directory: string
let settingsPath: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-graphics-acceleration-'))
  settingsPath = join(directory, 'settings.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function graphicsAccelerationIpc(inUse: boolean) {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as unknown as IpcMain
  let settings: AppSettings = { ...DEFAULT_SETTINGS }
  const host = {
    assertTrustedSender: vi.fn(),
    inUse,
    settings: () => settings,
    updateSettings: vi.fn(async (updates: Partial<AppSettings>) => {
      settings = { ...settings, ...updates }
      return settings
    }),
    publishSettings: vi.fn()
  }
  registerGraphicsAccelerationIpc(ipcMain, host)
  const invoke = (channel: string, ...args: unknown[]) =>
    Promise.resolve().then(() => handlers.get(channel)!({} as IpcMainInvokeEvent, ...args))
  return { invoke, host, settings: () => settings }
}

describe('graphics acceleration at startup', () => {
  it('stays on unless the saved settings turn it off', async () => {
    expect(readSavedGraphicsAcceleration(settingsPath)).toBe(true)
    for (const [saved, expected] of [
      [{ graphicsAcceleration: false }, false],
      [{ graphicsAcceleration: true }, true],
      [{ graphicsAcceleration: 'false' }, true],
      [{ theme: 'matrix' }, true],
      [[false], true],
      [null, true]
    ] as const) {
      await writeFile(settingsPath, JSON.stringify(saved), 'utf8')
      expect(readSavedGraphicsAcceleration(settingsPath), JSON.stringify(saved)).toBe(expected)
    }
    await writeFile(settingsPath, '{"graphicsAcceleration": false', 'utf8')
    expect(readSavedGraphicsAcceleration(settingsPath)).toBe(true)
  })

  it('reads the setting back as the settings store does', async () => {
    for (const saved of [{ graphicsAcceleration: false }, { graphicsAcceleration: 'off' }, {}]) {
      await writeFile(settingsPath, JSON.stringify(saved), 'utf8')
      const loaded = await new SettingsStore(settingsPath).load()
      expect(loaded.graphicsAcceleration, JSON.stringify(saved)).toBe(readSavedGraphicsAcceleration(settingsPath))
    }
  })

  it('turns it off for this run only when the saved setting says so', async () => {
    const app = { disableHardwareAcceleration: vi.fn(), commandLine: { hasSwitch: vi.fn(() => false) } }
    expect(applySavedGraphicsAcceleration(app, settingsPath)).toBe(true)
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled()
    await writeFile(settingsPath, JSON.stringify({ graphicsAcceleration: false }), 'utf8')
    expect(applySavedGraphicsAcceleration(app, settingsPath)).toBe(false)
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce()
  })

  // A window too black to reach Settings has Chromium's own way back, starting once with --disable-gpu; that run
  // draws without the graphics card although the setting is on, so Settings must not count it as one with it.
  it('counts a run started with --disable-gpu as one without it', async () => {
    const app = { disableHardwareAcceleration: vi.fn(), commandLine: { hasSwitch: vi.fn((name: string) => name === 'disable-gpu') } }
    expect(applySavedGraphicsAcceleration(app, settingsPath)).toBe(false)
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled()
    await writeFile(settingsPath, JSON.stringify({ graphicsAcceleration: false }), 'utf8')
    expect(applySavedGraphicsAcceleration(app, settingsPath)).toBe(false)
    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce()
  })
})

describe('graphics acceleration in Settings', () => {
  it('saves a change for the next start and says what this run uses', async () => {
    const { invoke, host, settings } = graphicsAccelerationIpc(true)
    const result = await invoke('settings:set-graphics-acceleration', false) as AppSettings
    expect(host.assertTrustedSender).toHaveBeenCalledOnce()
    expect(host.updateSettings).toHaveBeenCalledWith({ graphicsAcceleration: false })
    expect(settings().graphicsAcceleration).toBe(false)
    expect(result).toEqual(settings())
    expect(result).not.toBe(settings())
    expect(host.publishSettings).toHaveBeenCalledOnce()
    await expect(invoke('settings:graphics-acceleration-in-use')).resolves.toBe(true)
    await expect(graphicsAccelerationIpc(false).invoke('settings:graphics-acceleration-in-use')).resolves.toBe(false)
  })

  it('refuses anything but a boolean, and windows other than Hronaut\'s own', async () => {
    const { invoke, host } = graphicsAccelerationIpc(true)
    for (const value of ['false', 0, null, undefined]) {
      await expect(invoke('settings:set-graphics-acceleration', value)).rejects.toThrow(TypeError)
    }
    host.assertTrustedSender.mockImplementation(() => { throw new Error('Untrusted sender') })
    await expect(invoke('settings:set-graphics-acceleration', false)).rejects.toThrow('Untrusted sender')
    await expect(invoke('settings:graphics-acceleration-in-use')).rejects.toThrow('Untrusted sender')
    expect(host.updateSettings).not.toHaveBeenCalled()
  })
})
