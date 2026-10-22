import { describe, expect, it, vi } from 'vitest'
import { useSitePermissionsController } from '../../src/renderer/src/composables/useSitePermissionsController.js'
import type { SitePermissionEntry } from '../../src/shared/types.js'

const permission = (decision: 'allow' | 'deny'): SitePermissionEntry => ({
  origin: 'https://example.test',
  permission: 'geolocation',
  decision
})

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function createController(fileSavingOn = false) {
  let fileSavingEnabled = fileSavingOn
  const fileSaving = {
    enabled: () => fileSavingEnabled,
    set: vi.fn(async (enabled: boolean) => { fileSavingEnabled = enabled })
  }
  const api = {
    set: vi.fn(async (_origin: string, _name: string, decision: 'allow' | 'deny') => permission(decision)),
    remove: vi.fn(async () => true),
    clear: vi.fn(async () => undefined)
  }
  const onError = vi.fn()
  const controller = useSitePermissionsController({
    api,
    onError,
    translate: (key) => key,
    workspaces: () => [],
    fileSaving
  })
  controller.replace([permission('allow')])
  return { api, controller, onError, fileSaving }
}

describe('site permissions controller', () => {
  it.each(['set', 'remove', 'clear'] as const)('rejects an initial list that predates a successful %s mutation', async action => {
    const loading = deferred<SitePermissionEntry[]>()
    const { controller } = createController()
    const initialization = controller.initialize(loading.promise)
    const changed = action === 'set'
      ? controller.setDecision(permission('allow'), 'deny')
      : action === 'remove' ? controller.remove(permission('allow')) : controller.clear()
    await expect(changed).resolves.toBe(true)
    loading.resolve([permission('allow')])
    await initialization
    expect(controller.entries.value).toEqual(action === 'set' ? [permission('deny')] : [])
    controller.dispose()
  })

  it('does not let initial loading invalidate a pending mutation response', async () => {
    const loading = deferred<SitePermissionEntry[]>()
    const saving = deferred<SitePermissionEntry>()
    const { api, controller } = createController()
    api.set.mockImplementationOnce(() => saving.promise)
    const initialization = controller.initialize(loading.promise)
    const operation = controller.setDecision(permission('allow'), 'deny')
    loading.resolve([permission('allow')])
    await initialization
    saving.resolve(permission('deny'))
    await expect(operation).resolves.toBe(true)
    expect(controller.entries.value).toEqual([permission('deny')])
    controller.dispose()
  })

  it('keeps the most recently requested initial list when loads finish out of order', async () => {
    const first = deferred<SitePermissionEntry[]>()
    const second = deferred<SitePermissionEntry[]>()
    const { controller } = createController()
    const firstLoad = controller.initialize(first.promise)
    const secondLoad = controller.initialize(second.promise)
    first.resolve([permission('allow')])
    await firstLoad
    second.resolve([permission('deny')])
    await secondLoad
    expect(controller.entries.value).toEqual([permission('deny')])
    controller.dispose()
  })

  it('does not let a delayed initial list overwrite a newer permission event', async () => {
    const loading = deferred<SitePermissionEntry[]>()
    const { controller } = createController()

    const initialization = controller.initialize(loading.promise)
    controller.replace([permission('deny')])
    loading.resolve([permission('allow')])
    await initialization

    expect(controller.entries.value).toEqual([permission('deny')])
    controller.dispose()
  })

  it('does not let an older mutation response overwrite a newer permission event', async () => {
    const saving = deferred<SitePermissionEntry>()
    const { api, controller } = createController()
    api.set.mockImplementationOnce(() => saving.promise)

    const operation = controller.setDecision(permission('allow'), 'deny')
    controller.replace([permission('allow')])
    saving.resolve(permission('deny'))
    await operation

    expect(controller.entries.value).toEqual([permission('allow')])
    controller.dispose()
  })

  // Reset to default forgot the saved decisions but left saving to every file a website holds on, though it is off by
  // default and the section's warning is about it.
  it('turns saving to files a website holds back off when the section resets, before it forgets the decisions', async () => {
    const { api, controller, fileSaving } = createController(true)
    const switching = deferred<void>()
    fileSaving.set.mockImplementationOnce(async () => {
      await switching.promise
      await fileSaving.set(false)
    })

    const reset = controller.clear()
    expect(controller.fileSavingPending.value).toBe(true)
    expect(api.clear).not.toHaveBeenCalled()
    switching.resolve()

    await expect(reset).resolves.toBe(true)
    expect(fileSaving.set).toHaveBeenCalledWith(false)
    expect(controller.fileSavingEnabled.value).toBe(false)
    expect(controller.fileSavingPending.value).toBe(false)
    expect(api.clear).toHaveBeenCalledOnce()
    expect(controller.entries.value).toEqual([])
    controller.dispose()
  })

  it('keeps the decisions when the switch can\'t be turned off, and leaves an off switch alone', async () => {
    const failing = createController(true)
    failing.fileSaving.set.mockRejectedValueOnce(new Error('settings write failed'))
    await expect(failing.controller.clear()).resolves.toBe(false)
    expect(failing.api.clear).not.toHaveBeenCalled()
    expect(failing.controller.entries.value).toEqual([permission('allow')])
    expect(failing.onError).toHaveBeenCalledOnce()
    failing.controller.dispose()

    const off = createController(false)
    await expect(off.controller.clear()).resolves.toBe(true)
    expect(off.fileSaving.set).not.toHaveBeenCalled()
    expect(off.api.clear).toHaveBeenCalledOnce()
    off.controller.dispose()
  })

  it('waits for a change to the switch before the section resets', async () => {
    const switching = deferred<void>()
    const { api, controller, fileSaving } = createController(false)
    fileSaving.set.mockImplementationOnce(() => switching.promise)

    const change = controller.setFileSaving(true)
    await expect(controller.clear()).resolves.toBe(false)
    expect(api.clear).not.toHaveBeenCalled()
    switching.resolve()
    await change
    controller.dispose()
  })

  it('blocks a global reset while a row mutation is pending', async () => {
    const saving = deferred<SitePermissionEntry>()
    const { api, controller } = createController()
    api.set.mockImplementationOnce(() => saving.promise)

    const operation = controller.setDecision(permission('allow'), 'deny')

    expect(controller.busy.value).toBe(true)
    await expect(controller.clear()).resolves.toBe(false)
    expect(api.clear).not.toHaveBeenCalled()
    saving.resolve(permission('deny'))
    await operation
    controller.dispose()
  })

  it('retains authoritative state and reports persistence failures', async () => {
    const { api, controller, onError } = createController()
    api.set.mockRejectedValueOnce(new Error('permission store unavailable'))

    await expect(controller.setDecision(permission('allow'), 'deny')).resolves.toBe(false)

    expect(controller.entries.value).toEqual([permission('allow')])
    expect(controller.errorMessage.value).toBe('permission store unavailable')
    expect(onError).toHaveBeenCalledOnce()
    expect(controller.busy.value).toBe(false)
    controller.dispose()
  })

  it('shows a main-process failure without Electron\'s IPC wrapper', async () => {
    const { api, controller } = createController()
    api.set.mockRejectedValueOnce(new Error("Error invoking remote method 'permissions:set': Error: The permission store is unavailable."))

    await expect(controller.setDecision(permission('allow'), 'deny')).resolves.toBe(false)

    expect(controller.errorMessage.value).toBe('The permission store is unavailable.')
    controller.dispose()
  })
})
