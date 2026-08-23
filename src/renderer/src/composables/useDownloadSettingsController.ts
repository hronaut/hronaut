import { computed, ref, type Ref } from 'vue'
import type { AppSettings, HronautSettingsApi } from '../../../shared/types.js'

type DownloadSettingsApi = Pick<
  HronautSettingsApi,
  'chooseDownloadDirectory' | 'openDownloadDirectory' | 'resetDownloads' | 'setAskWhereToSaveDownloads'
>
type Translate = (key: string) => string
type DownloadSettingsState = 'idle' | 'working' | 'saved' | 'error'

export interface DownloadSettingsControllerOptions {
  api: DownloadSettingsApi
  settings: Ref<AppSettings>
  defaultDirectory: Ref<string>
  applySettings: (settings: AppSettings) => void
  translate: Translate
}

export function useDownloadSettingsController(options: DownloadSettingsControllerOptions) {
  const state = ref<DownloadSettingsState>('idle')
  const message = ref('')
  let generation = 0

  const busy = computed(() => state.value === 'working')
  const effectiveDirectory = computed(() => (
    options.settings.value.downloadDirectory
    || options.defaultDirectory.value
    || options.translate('runtime.storage.systemDownloads')
  ))

  function fail(operation: number, error: unknown): false {
    if (operation !== generation) return false
    state.value = 'error'
    message.value = error instanceof Error ? error.message : String(error)
    return false
  }

  function begin(statusMessage: string): number | null {
    if (busy.value) return null
    const operation = ++generation
    state.value = 'working'
    message.value = statusMessage
    return operation
  }

  async function chooseDirectory(): Promise<boolean> {
    const operation = begin(options.translate('runtime.downloadSettings.openingPicker'))
    if (operation === null) return false
    try {
      const result = await options.api.chooseDownloadDirectory()
      if (operation !== generation) return false
      if (result.canceled) {
        state.value = 'idle'
        message.value = ''
        return false
      }
      options.applySettings(result.settings)
      state.value = 'saved'
      message.value = options.translate('runtime.downloadSettings.folderSelected')
      return true
    } catch (error) {
      return fail(operation, error)
    }
  }

  async function setAskWhereToSave(enabled: boolean): Promise<boolean> {
    const operation = begin(options.translate('runtime.downloadSettings.saving'))
    if (operation === null) return false
    try {
      const next = await options.api.setAskWhereToSaveDownloads(enabled)
      if (operation !== generation) return false
      options.applySettings(next)
      state.value = 'saved'
      message.value = options.translate(enabled
        ? 'runtime.downloadSettings.ask'
        : 'runtime.downloadSettings.automatic')
      return true
    } catch (error) {
      return fail(operation, error)
    }
  }

  async function openDirectory(): Promise<boolean> {
    const operation = begin(options.translate('runtime.downloadSettings.openingFolder'))
    if (operation === null) return false
    try {
      await options.api.openDownloadDirectory()
      if (operation !== generation) return false
      state.value = 'idle'
      message.value = ''
      return true
    } catch (error) {
      return fail(operation, error)
    }
  }

  async function reset(): Promise<boolean> {
    const operation = begin(options.translate('runtime.downloadSettings.restoring'))
    if (operation === null) return false
    try {
      const next = await options.api.resetDownloads()
      if (operation !== generation) return false
      options.applySettings(next)
      state.value = 'saved'
      message.value = options.translate('runtime.downloadSettings.restored')
      return true
    } catch (error) {
      return fail(operation, error)
    }
  }

  function dispose(): void {
    generation += 1
  }

  return {
    settings: options.settings,
    state,
    message,
    busy,
    effectiveDirectory,
    chooseDirectory,
    setAskWhereToSave,
    openDirectory,
    reset,
    dispose
  }
}

export type DownloadSettingsController = ReturnType<typeof useDownloadSettingsController>
