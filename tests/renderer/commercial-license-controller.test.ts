import { describe, expect, it, vi } from 'vitest'
import { useCommercialLicenseController } from '../../src/renderer/src/composables/useCommercialLicenseController.js'
import type { HronautLicenseApi, CommercialLicenseState } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function license(overrides: Partial<CommercialLicenseState> = {}): CommercialLicenseState {
  return {
    status: 'not-activated',
    active: false,
    secureStorageAvailable: true,
    ...overrides
  }
}

function createController(
  getState: () => Promise<CommercialLicenseState> = async () => license(),
  onSubscribe?: (listener: (state: CommercialLicenseState) => void) => void
) {
  let listener: ((state: CommercialLicenseState) => void) | undefined
  const activate = vi.fn(async () => license({ status: 'active', active: true, maskedKey: '••••-TEST' }))
  const refresh = vi.fn(async () => license({ status: 'active', active: true, maskedKey: '••••-TEST' }))
  const deactivate = vi.fn(async () => license())
  const unsubscribe = vi.fn(() => { listener = undefined })
  const api: HronautLicenseApi = {
    getState: vi.fn(getState),
    activate,
    refresh,
    deactivate,
    openPurchase: vi.fn(async () => undefined),
    onChanged: vi.fn((next: (state: CommercialLicenseState) => void) => {
      listener = next
      onSubscribe?.(next)
      return unsubscribe
    })
  }
  const confirmDeactivate = vi.fn(() => true)
  const controller = useCommercialLicenseController({
    api,
    confirmDeactivate,
    emptyKeyMessage: () => 'Enter a commercial license key',
    formatError: (error) => error instanceof Error ? error.message : String(error)
  })
  return {
    activate,
    confirmDeactivate,
    controller,
    deactivate,
    emit: (state: CommercialLicenseState) => listener?.(state),
    refresh,
    unsubscribe
  }
}

describe('commercial license controller', () => {
  it('does not overwrite a live license event with an older initialization snapshot', async () => {
    const initial = deferred<CommercialLicenseState>()
    const { controller, emit } = createController(() => initial.promise)

    const initializing = controller.initialize()
    emit(license({ status: 'active', active: true, maskedKey: '••••-LIVE' }))
    initial.resolve(license())
    await initializing

    expect(controller.state.value).toMatchObject({ active: true, maskedKey: '••••-LIVE' })
    controller.dispose()
  })

  it('preserves a license event delivered while the listener is being attached', async () => {
    const live = license({ status: 'active', active: true, maskedKey: '••••-LIVE' })
    const { controller } = createController(async () => license(), (listener) => listener(live))

    await controller.initialize()

    expect(controller.state.value).toEqual(live)
    controller.dispose()
  })

  it('keeps a newer event when an earlier activation response resolves later', async () => {
    const activating = deferred<CommercialLicenseState>()
    const { activate, controller, emit } = createController()
    await controller.initialize()
    activate.mockImplementationOnce(() => activating.promise)
    controller.keyDraft.value = 'ABCD-EFGH-IJKL-MNOP'

    const operation = controller.activate()
    emit(license({ status: 'active', active: true, maskedKey: '••••-LIVE' }))
    activating.resolve(license({ status: 'active', active: true, maskedKey: '••••-OLD' }))
    await expect(operation).resolves.toBe(true)

    expect(controller.state.value.maskedKey).toBe('••••-LIVE')
    expect(controller.keyDraft.value).toBe('')
    controller.dispose()
  })

  it('validates an empty key and blocks overlapping actions', async () => {
    const activating = deferred<CommercialLicenseState>()
    const { activate, controller, refresh } = createController()
    await controller.initialize()

    await expect(controller.activate()).resolves.toBe(false)
    expect(controller.errorMessage.value).toBe('Enter a commercial license key')
    expect(activate).not.toHaveBeenCalled()

    controller.keyDraft.value = 'ABCD-EFGH-IJKL-MNOP'
    activate.mockImplementationOnce(() => activating.promise)
    const operation = controller.activate()
    await expect(controller.refresh()).resolves.toBe(false)
    expect(refresh).not.toHaveBeenCalled()
    activating.resolve(license({ status: 'active', active: true }))
    await operation
    controller.dispose()
  })

  it('does not deactivate when confirmation is cancelled', async () => {
    const { confirmDeactivate, controller, deactivate } = createController()
    confirmDeactivate.mockReturnValueOnce(false)

    await expect(controller.deactivate()).resolves.toBe(false)

    expect(deactivate).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('shows the license source error when listener cleanup also fails', async () => {
    const initial = deferred<CommercialLicenseState>()
    const sourceError = new Error('license service unavailable')
    const { controller, unsubscribe } = createController(() => initial.promise)
    unsubscribe.mockImplementationOnce(() => {
      throw new Error('license listener already closed')
    })

    const initializing = controller.initialize()
    initial.reject(sourceError)
    await expect(initializing).rejects.toThrow()

    expect(controller.errorMessage.value).toBe('license service unavailable')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('clears a pending license action when listener disposal fails', async () => {
    const activating = deferred<CommercialLicenseState>()
    const { activate, controller, unsubscribe } = createController()
    await controller.initialize()
    activate.mockReturnValueOnce(activating.promise)
    controller.keyDraft.value = 'ABCD-EFGH-IJKL-MNOP'
    const activation = controller.activate()
    expect(controller.action.value).toBe('activating')
    unsubscribe.mockImplementationOnce(() => {
      throw new Error('license listener already closed')
    })

    expect(() => controller.dispose()).toThrow('license listener already closed')

    expect(controller.action.value).toBe('idle')
    activating.resolve(license({ status: 'active', active: true }))
    await expect(activation).resolves.toBe(false)
  })
})
