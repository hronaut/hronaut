import { computed, ref, type Ref } from 'vue'
import type { AppSettings, AppUpdateState, HronautUpdatesApi } from '../../../shared/types.js'

type UpdateOperation = 'idle' | 'checking' | 'downloading' | 'installing' | 'saving-setting'

export interface UpdateSettingsControllerOptions {
  api: HronautUpdatesApi
  settings: Readonly<Ref<AppSettings>>
  setCheckOnStartup: (enabled: boolean) => Promise<AppSettings>
  onCheckStarted: () => void
  onStateAccepted: (state: AppUpdateState) => void
  onSettingError: (error: unknown) => void
  onActionError: (error: unknown) => void
}

export function useUpdateSettingsController(options: UpdateSettingsControllerOptions) {
  const state = ref<AppUpdateState>({ status: 'idle', currentVersion: '' })
  const operation = ref<UpdateOperation>('idle')
  let generation = 0
  let revision = 0
  let initializePromise: Promise<void> | null = null
  let unsubscribe: (() => void) | null = null

  const stateBusy = computed(() => (
    state.value.status === 'checking'
    || state.value.status === 'downloading'
    || state.value.status === 'installing'
  ))
  const busy = computed(() => operation.value !== 'idle' || stateBusy.value)

  function accept(next: AppUpdateState): void {
    revision += 1
    state.value = next
    options.onStateAccepted(next)
  }

  function detachListener(): void {
    const current = unsubscribe
    unsubscribe = null
    current?.()
  }

  function initialize(): Promise<void> {
    if (initializePromise) return initializePromise
    const currentGeneration = ++generation
    const initialRevision = revision
    detachListener()
    unsubscribe = options.api.onChanged((next) => {
      if (generation === currentGeneration) accept(next)
    })
    initializePromise = options.api.getState()
      .then((next) => {
        if (generation === currentGeneration && revision === initialRevision) accept(next)
      })
      .catch((error: unknown) => {
        if (generation !== currentGeneration) return
        const failures = [error]
        try {
          detachListener()
        } catch (cleanupError) {
          failures.push(cleanupError)
        }
        try {
          options.onActionError(error)
        } catch (reportingError) {
          failures.push(reportingError)
        }
        if (failures.length === 1) throw error
        throw new AggregateError(failures, 'Update initialization failed and listener cleanup was incomplete')
      })
      .finally(() => {
        if (generation === currentGeneration) initializePromise = null
      })
    return initializePromise
  }

  async function runStateAction(
    nextOperation: 'checking' | 'downloading',
    action: () => Promise<AppUpdateState>
  ): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    const startingRevision = revision
    operation.value = nextOperation
    try {
      const next = await action()
      if (operationGeneration !== generation) return false
      if (revision === startingRevision) accept(next)
      return true
    } catch (error) {
      if (operationGeneration === generation) options.onActionError(error)
      return false
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  function check(): Promise<boolean> {
    if (busy.value) return Promise.resolve(false)
    options.onCheckStarted()
    return runStateAction('checking', () => options.api.check())
  }

  function download(): Promise<boolean> {
    return runStateAction('downloading', () => options.api.download())
  }

  async function install(): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    operation.value = 'installing'
    try {
      return await options.api.install()
    } catch (error) {
      if (operationGeneration === generation) options.onActionError(error)
      return false
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  async function setCheckOnStartup(enabled: boolean): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    operation.value = 'saving-setting'
    try {
      await options.setCheckOnStartup(enabled)
      return operationGeneration === generation
    } catch (error) {
      if (operationGeneration === generation) options.onSettingError(error)
      return false
    } finally {
      if (operationGeneration === generation) operation.value = 'idle'
    }
  }

  function reset(): Promise<boolean> {
    return setCheckOnStartup(true)
  }

  function dispose(): void {
    generation += 1
    initializePromise = null
    operation.value = 'idle'
    detachListener()
  }

  return {
    settings: options.settings,
    state,
    operation,
    busy,
    initialize,
    accept,
    check,
    download,
    install,
    setCheckOnStartup,
    reset,
    dispose
  }
}

export type UpdateSettingsController = ReturnType<typeof useUpdateSettingsController>
