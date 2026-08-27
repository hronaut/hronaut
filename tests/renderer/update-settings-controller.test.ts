import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useUpdateSettingsController } from '../../src/renderer/src/composables/useUpdateSettingsController.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings, AppUpdateState, HronautUpdatesApi } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function update(status: AppUpdateState['status'], currentVersion = '1.7.1'): AppUpdateState {
  return { status, currentVersion }
}

function createController(
  getState: () => Promise<AppUpdateState> = async () => update('idle'),
  onSubscribe?: (listener: (state: AppUpdateState) => void) => void
) {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  let listener: ((state: AppUpdateState) => void) | undefined
  const check = vi.fn(async () => update('up-to-date'))
  const download = vi.fn(async () => update('downloaded'))
  const unsubscribe = vi.fn(() => { listener = undefined })
  const api: HronautUpdatesApi = {
    getState: vi.fn(getState),
    check,
    download,
    install: vi.fn(async () => true),
    onChanged: vi.fn((next: (state: AppUpdateState) => void) => {
      listener = next
      onSubscribe?.(next)
      return unsubscribe
    }),
    onOpenRequested: vi.fn(() => () => undefined)
  }
  const setCheckOnStartup = vi.fn(async (enabled: boolean) => {
    settings.value = { ...settings.value, checkForUpdatesOnStartup: enabled }
    return settings.value
  })
  const onCheckStarted = vi.fn()
  const onStateAccepted = vi.fn()
  const onSettingError = vi.fn()
  const onActionError = vi.fn()
  const controller = useUpdateSettingsController({
    api,
    settings,
    setCheckOnStartup,
    onCheckStarted,
    onStateAccepted,
    onSettingError,
    onActionError
  })
  return {
    api,
    check,
    controller,
    download,
    emit: (state: AppUpdateState) => listener?.(state),
    onActionError,
    onCheckStarted,
    onSettingError,
    onStateAccepted,
    setCheckOnStartup,
    settings,
    unsubscribe
  }
}

describe('update settings controller', () => {
  it('does not overwrite a live update event with an older initialization snapshot', async () => {
    const initial = deferred<AppUpdateState>()
    const { controller, emit } = createController(() => initial.promise)

    const initializing = controller.initialize()
    emit({ ...update('available'), availableVersion: '1.8.0' })
    initial.resolve(update('idle'))
    await initializing

    expect(controller.state.value).toMatchObject({ status: 'available', availableVersion: '1.8.0' })
    controller.dispose()
  })

  it('preserves an update event delivered while the listener is being attached', async () => {
    const available = { ...update('available'), availableVersion: '1.8.0' }
    const { controller } = createController(async () => update('idle'), (listener) => listener(available))

    await controller.initialize()

    expect(controller.state.value).toEqual(available)
    controller.dispose()
  })

  it('keeps a newer event when an earlier check response resolves later', async () => {
    const checking = deferred<AppUpdateState>()
    const { check, controller, emit, onCheckStarted } = createController()
    await controller.initialize()
    check.mockImplementationOnce(() => checking.promise)

    const operation = controller.check()
    emit({ ...update('downloaded'), availableVersion: '1.8.0' })
    checking.resolve(update('up-to-date'))
    await expect(operation).resolves.toBe(true)

    expect(onCheckStarted).toHaveBeenCalledOnce()
    expect(controller.state.value.status).toBe('downloaded')
    controller.dispose()
  })

  it('blocks overlapping update and setting actions', async () => {
    const checking = deferred<AppUpdateState>()
    const { check, controller, download, setCheckOnStartup } = createController()
    await controller.initialize()
    check.mockImplementationOnce(() => checking.promise)

    const operation = controller.check()
    await expect(controller.download()).resolves.toBe(false)
    await expect(controller.setCheckOnStartup(false)).resolves.toBe(false)

    expect(download).not.toHaveBeenCalled()
    expect(setCheckOnStartup).not.toHaveBeenCalled()
    checking.resolve(update('up-to-date'))
    await operation
    controller.dispose()
  })

  it('reports startup-setting persistence failures without changing authoritative settings', async () => {
    const { controller, onSettingError, setCheckOnStartup, settings } = createController()
    setCheckOnStartup.mockRejectedValueOnce(new Error('settings unavailable'))

    await expect(controller.setCheckOnStartup(false)).resolves.toBe(false)

    expect(settings.value.checkForUpdatesOnStartup).toBe(true)
    expect(onSettingError).toHaveBeenCalledWith(expect.any(Error))
    controller.dispose()
  })

  it('reports the source initialization error when listener cleanup also fails', async () => {
    const initial = deferred<AppUpdateState>()
    const sourceError = new Error('update state unavailable')
    const cleanupError = new Error('update listener already closed')
    const { controller, onActionError, unsubscribe } = createController(() => initial.promise)
    unsubscribe.mockImplementationOnce(() => {
      throw cleanupError
    })

    const initializing = controller.initialize()
    initial.reject(sourceError)
    await expect(initializing).rejects.toThrow()

    expect(onActionError).toHaveBeenCalledWith(sourceError)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('clears a pending update operation when native listener disposal fails', async () => {
    const pendingCheck = deferred<AppUpdateState>()
    const { check, controller, unsubscribe } = createController()
    await controller.initialize()
    check.mockReturnValueOnce(pendingCheck.promise)
    const checking = controller.check()
    expect(controller.operation.value).toBe('checking')
    unsubscribe.mockImplementationOnce(() => {
      throw new Error('update listener already closed')
    })

    expect(() => controller.dispose()).toThrow('update listener already closed')

    expect(controller.operation.value).toBe('idle')
    pendingCheck.resolve(update('up-to-date'))
    await expect(checking).resolves.toBe(false)
  })
})
