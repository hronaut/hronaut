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

function createController() {
  const api = {
    set: vi.fn(async (_origin: string, _name: string, decision: 'allow' | 'deny') => permission(decision)),
    remove: vi.fn(async () => true),
    clear: vi.fn(async () => undefined)
  }
  const onError = vi.fn()
  const controller = useSitePermissionsController({
    api,
    onError,
    translate: (key) => key
  })
  controller.replace([permission('allow')])
  return { api, controller, onError }
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
})
