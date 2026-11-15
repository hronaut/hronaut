import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../src/shared/i18n.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeTheme: {} }))

const { registerSettingsIpc } = await import('../src/main/settings/settings-ipc.js')
const { withTranslatedIpcErrors } = await import('../src/main/localized-error.js')
const { createSettingsRuntime } = await import('../src/main/settings/settings-runtime.js')
const { DEFAULT_SETTINGS } = await import('../src/main/settings/settings-store.js')

// Choosing or opening the download folder in Settings showed Node's English error with the folder's path, such as
// "ENOTDIR: not a directory, mkdir '…'", or the file manager's own English text, whatever the interface language.

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

let root: string

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hronaut-download-folder-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

function settingsIpc(options: { directory: string, openPath?: () => Promise<string>, chosen?: string, saveDialogDirectory?: string }) {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) }, on: () => ipcMain } as unknown as IpcMain
  const translated = withTranslatedIpcErrors(ipcMain, { isHronautPage: () => true, text: (key, parameters) => translate('de-DE', key, parameters) })
  const openPath = vi.fn(options.openPath ?? (async () => ''))
  const setDownloadPath = vi.fn()
  const save = vi.fn(async () => undefined)
  const settings = { ...DEFAULT_SETTINGS, saveDialogDirectory: options.saveDialogDirectory ?? null }
  // The real settings runtime, so choosing a folder creates it the way Hronaut does before saving the setting.
  const runtime = createSettingsRuntime({
    state: { store: { save }, persisted: settings, current: settings, systemLocale: 'de-DE', resolvedLocale: 'de-DE', mutationQueue: Promise.resolve(), startupLaunchManager: null },
    persistentSession: () => ({ setDownloadPath }),
    tabs: () => null,
    sendToShellWindows: () => undefined,
    mainWindowRefs: { material: undefined }
  } as never)
  registerSettingsIpc(translated, {
    assertTrustedSender: () => undefined,
    handleBrowserIpc: () => undefined,
    effectiveDownloadDirectory: () => options.directory,
    openPath,
    chooseDownloadDirectory: async () => ({ canceled: false, filePaths: [options.chosen ?? options.directory] }),
    applyDownloadSettings: runtime.applyDownloadSettings
  } as never)
  const invoke = (channel: string) => Promise.resolve().then(() => handlers.get(channel)!({} as IpcMainInvokeEvent))
  return { invoke, openPath, setDownloadPath, save, runtime }
}

describe('opening the download folder from Settings', () => {
  it('says in the interface language that a file is in the way, without the path', async () => {
    const file = join(root, 'Downloads')
    await writeFile(file, 'not a folder')
    const { invoke, openPath } = settingsIpc({ directory: join(file, 'Hronaut') })
    const error = await invoke('settings:open-download-directory').catch((caught: unknown) => caught as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Eine Datei steht dem Downloadordner im Weg (ENOTDIR). Wählen Sie einen anderen Ordner.')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('says in the interface language that the file manager could not open it', async () => {
    const { invoke } = settingsIpc({ directory: join(root, 'Downloads'), openPath: async () => 'Failed to open path' })
    await expect(invoke('settings:open-download-directory')).rejects.toThrow('Hronaut konnte den Downloadordner nicht im Dateimanager öffnen.')
  })

  it('opens a folder it could create', async () => {
    const { invoke, openPath } = settingsIpc({ directory: join(root, 'Downloads', 'Hronaut') })
    await expect(invoke('settings:open-download-directory')).resolves.toBeUndefined()
    expect(openPath).toHaveBeenCalledWith(join(root, 'Downloads', 'Hronaut'))
  })
})

describe('choosing the download folder in Settings', () => {
  it('says in the interface language that a file is in the way, and keeps the folder Hronaut downloads to', async () => {
    const file = join(root, 'Downloads')
    await writeFile(file, 'not a folder')
    const { invoke, setDownloadPath } = settingsIpc({ directory: root, chosen: join(file, 'Hronaut') })
    const error = await invoke('settings:choose-download-directory').catch((caught: unknown) => caught as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Eine Datei steht dem Downloadordner im Weg (ENOTDIR). Wählen Sie einen anderen Ordner.')
    expect(setDownloadPath).not.toHaveBeenCalled()
  })
})

describe('the folder the save dialogs start in', () => {
  it('is the one the last save dialog saved into, kept with the settings, until the person picks a download folder, as in Chrome', async () => {
    const last = join(root, 'Last')
    const { invoke, save, runtime } = settingsIpc({ directory: join(root, 'Downloads'), chosen: join(root, 'Picked') })
    const options = runtime.browserDownloadOptions()
    expect(options.getSaveDialogDirectory!()).toBeNull()
    options.setSaveDialogDirectory!(last)
    await vi.waitFor(() => { expect(options.getSaveDialogDirectory!()).toBe(last) })
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ saveDialogDirectory: last }))

    const chosen = await invoke('settings:choose-download-directory') as { settings: { saveDialogDirectory: string | null }, canceled: boolean }
    expect(chosen).toMatchObject({ canceled: false, settings: { downloadDirectory: join(root, 'Picked'), saveDialogDirectory: null } })
    expect(options.getSaveDialogDirectory!()).toBeNull()
  })

  it('goes back to the download folder when Settings resets downloads', async () => {
    const { invoke, runtime } = settingsIpc({ directory: join(root, 'Downloads'), saveDialogDirectory: join(root, 'Last') })
    await expect(invoke('settings:reset-downloads')).resolves.toMatchObject({ saveDialogDirectory: null })
    expect(runtime.browserDownloadOptions().getSaveDialogDirectory!()).toBeNull()
  })
})
