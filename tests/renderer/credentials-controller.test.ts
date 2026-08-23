import { describe, expect, it, vi } from 'vitest'
import { useCredentialsController } from '../../src/renderer/src/composables/useCredentialsController.js'
import type { CredentialStorageStatus, CredentialSummary } from '../../src/shared/types.js'

function credential(id: string, username = 'Person'): CredentialSummary {
  return {
    id,
    origin: 'https://example.test',
    username,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z'
  }
}

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
    importFromCsv: vi.fn(async () => ({ canceled: false, added: 0, updated: 0, skipped: 0 })),
    remove: vi.fn(async () => true)
  }
  const onRemoved = vi.fn()
  const onError = vi.fn()
  const controller = useCredentialsController({
    api,
    initializingReason: 'Initializing secure storage',
    missingCredentialMessage: 'Saved credential no longer exists',
    formatError: (error) => error instanceof Error ? error.message : String(error),
    onRemoved,
    onError
  })
  controller.replace([credential('first')])
  return { api, controller, onError, onRemoved }
}

describe('credentials controller', () => {
  it('does not let a delayed initial list overwrite a newer credential event', async () => {
    const loading = deferred<CredentialSummary[]>()
    const status: CredentialStorageStatus = { available: true, backend: 'test vault' }
    const { controller } = createController()

    const initialization = controller.initialize(Promise.resolve(status), loading.promise)
    controller.replace([credential('newer')])
    loading.resolve([credential('stale')])
    await initialization

    expect(controller.storage.value).toEqual(status)
    expect(controller.entries.value).toEqual([credential('newer')])
    controller.dispose()
  })

  it('does not let an older removal response erase a credential restored by a newer event', async () => {
    const removing = deferred<boolean>()
    const { api, controller } = createController()
    api.remove.mockImplementationOnce(() => removing.promise)

    const operation = controller.remove('first')
    controller.replace([credential('first', 'Updated person')])
    removing.resolve(true)
    await operation

    expect(controller.entries.value).toEqual([credential('first', 'Updated person')])
    controller.dispose()
  })

  it('blocks duplicate removal requests for the same credential', async () => {
    const removing = deferred<boolean>()
    const { api, controller } = createController()
    api.remove.mockImplementationOnce(() => removing.promise)

    const first = controller.remove('first')
    await expect(controller.remove('first')).resolves.toBe(false)
    expect(api.remove).toHaveBeenCalledOnce()
    removing.resolve(true)
    await first
    controller.dispose()
  })

  it('retains authoritative state and reports persistence failures', async () => {
    const { api, controller, onError, onRemoved } = createController()
    api.remove.mockRejectedValueOnce(new Error('credential vault unavailable'))

    await expect(controller.remove('first')).resolves.toBe(false)

    expect(controller.entries.value).toEqual([credential('first')])
    expect(controller.errorMessage.value).toBe('credential vault unavailable')
    expect(onError).toHaveBeenCalledOnce()
    expect(onRemoved).not.toHaveBeenCalled()
    expect(controller.busy.value).toBe(false)
    controller.dispose()
  })
})
