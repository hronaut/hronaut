import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useDownloadSettingsController } from '../../src/renderer/src/composables/useDownloadSettingsController.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings, DownloadDirectorySelection } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function createController() {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const defaultDirectory = ref('/home/test/Downloads')
  const api = {
    chooseDownloadDirectory: vi.fn(async (): Promise<DownloadDirectorySelection> => ({
      canceled: false,
      settings: { ...settings.value, downloadDirectory: '/tmp/chosen' }
    })),
    setAskWhereToSaveDownloads: vi.fn(async (enabled: boolean): Promise<AppSettings> => ({
      ...settings.value,
      askWhereToSaveDownloads: enabled
    })),
    resetDownloads: vi.fn(async (): Promise<AppSettings> => ({
      ...settings.value,
      downloadDirectory: null,
      askWhereToSaveDownloads: false
    })),
    openDownloadDirectory: vi.fn(async () => undefined)
  }
  const applySettings = vi.fn((next: AppSettings) => { settings.value = next })
  const controller = useDownloadSettingsController({
    api,
    settings,
    defaultDirectory,
    applySettings,
    translate: (key) => key
  })
  return { api, applySettings, controller, settings }
}

describe('download settings controller', () => {
  it.each(['choose', 'save', 'reset'] as const)('preserves newer settings events during %s', async action => {
    const { api, applySettings, controller, settings } = createController()
    const result = deferred<AppSettings>()
    const stale = { ...settings.value, downloadDirectory: '/tmp/older' }
    api.chooseDownloadDirectory.mockImplementationOnce(async () => ({ canceled: false, settings: await result.promise }))
    api.setAskWhereToSaveDownloads.mockImplementationOnce(() => result.promise)
    api.resetDownloads.mockImplementationOnce(() => result.promise)

    const operation = action === 'choose' ? controller.chooseDirectory()
      : action === 'save' ? controller.setAskWhereToSave(true) : controller.reset()
    // The settings store replaces this object when main broadcasts a newer
    // authoritative snapshot, including changes from another shell window.
    settings.value = { ...settings.value, theme: 'dark', downloadDirectory: '/tmp/newer', askWhereToSaveDownloads: true }
    result.resolve(stale)

    await expect(operation).resolves.toBe(true)
    expect(applySettings).not.toHaveBeenCalled()
    expect(settings.value).toMatchObject({ theme: 'dark', downloadDirectory: '/tmp/newer', askWhereToSaveDownloads: true })
    expect(controller.busy.value).toBe(false)
    controller.dispose()
  })

  it('rejects reset and other operations while the folder chooser is pending', async () => {
    const selection = deferred<DownloadDirectorySelection>()
    const { api, controller, settings } = createController()
    api.chooseDownloadDirectory.mockImplementationOnce(() => selection.promise)

    const choosing = controller.chooseDirectory()

    expect(controller.busy.value).toBe(true)
    await expect(controller.reset()).resolves.toBe(false)
    await expect(controller.openDirectory()).resolves.toBe(false)
    await expect(controller.setAskWhereToSave(true)).resolves.toBe(false)
    expect(api.resetDownloads).not.toHaveBeenCalled()
    expect(api.openDownloadDirectory).not.toHaveBeenCalled()
    expect(api.setAskWhereToSaveDownloads).not.toHaveBeenCalled()

    selection.resolve({
      canceled: false,
      settings: { ...settings.value, downloadDirectory: '/tmp/newer' }
    })
    await expect(choosing).resolves.toBe(true)
    expect(settings.value.downloadDirectory).toBe('/tmp/newer')
    controller.dispose()
  })

  it('ignores a folder chooser result that arrives after disposal', async () => {
    const selection = deferred<DownloadDirectorySelection>()
    const { api, applySettings, controller, settings } = createController()
    api.chooseDownloadDirectory.mockImplementationOnce(() => selection.promise)

    const choosing = controller.chooseDirectory()
    controller.dispose()
    selection.resolve({
      canceled: false,
      settings: { ...settings.value, downloadDirectory: '/tmp/stale' }
    })

    await expect(choosing).resolves.toBe(false)
    expect(applySettings).not.toHaveBeenCalled()
  })

  it('keeps the authoritative checkbox value and reports an IPC failure', async () => {
    const { api, controller, settings } = createController()
    api.setAskWhereToSaveDownloads.mockRejectedValueOnce(new Error('disk unavailable'))

    await expect(controller.setAskWhereToSave(true)).resolves.toBe(false)

    expect(settings.value.askWhereToSaveDownloads).toBe(false)
    expect(controller.state.value).toBe('error')
    expect(controller.message.value).toBe('disk unavailable')
    controller.dispose()
  })
})
