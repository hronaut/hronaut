import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SupportSettingsPanel from '../../src/renderer/src/components/SupportSettingsPanel.vue'
import { useCommercialLicenseController } from '../../src/renderer/src/composables/useCommercialLicenseController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
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

function renderPanel(initial = license()) {
  const activate = vi.fn(async () => license({ status: 'active', active: true, maskedKey: '••••-TEST' }))
  const api: HronautLicenseApi = {
    getState: vi.fn(async () => initial),
    activate,
    refresh: vi.fn(async () => initial),
    deactivate: vi.fn(async () => license()),
    openPurchase: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => undefined)
  }
  const controller = useCommercialLicenseController({
    api,
    confirmDeactivate: () => true,
    emptyKeyMessage: () => 'Enter a commercial license key.',
    formatError: (error) => error instanceof Error ? error.message : String(error)
  })
  controller.accept(initial)
  const rendered = render(SupportSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      controller,
      formatNumber: (value: number) => String(value),
      formatDateTime: (value: string) => `formatted:${value}`
    }
  })
  return { activate, controller, rendered }
}

describe('SupportSettingsPanel', () => {
  it('renders active license metadata and formats validation details', () => {
    const { controller } = renderPanel(license({
      status: 'active',
      active: true,
      maskedKey: '••••-MNOP',
      activations: 2,
      activationLimit: 3,
      lastValidatedAt: '2026-08-22T12:00:00.000Z'
    }))

    expect(screen.getByRole('heading', { name: 'Thank you for licensing Hronaut' })).toBeVisible()
    expect(screen.getByText(/••••-MNOP/)).toBeVisible()
    expect(screen.getByText(/2 of 3 device activations used/)).toHaveTextContent('formatted:2026-08-22T12:00:00.000Z')
    controller.dispose()
  })

  it('disables activation controls while a request is pending and clears the accepted key', async () => {
    const activating = deferred<CommercialLicenseState>()
    const { activate, controller } = renderPanel()
    activate.mockImplementationOnce(() => activating.promise)
    const user = userEvent.setup()
    const key = screen.getByLabelText('Commercial license key')

    await user.type(key, 'ABCD-EFGH-IJKL-MNOP')
    await user.click(screen.getByRole('button', { name: 'Activate commercial license' }))

    expect(key).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Activating…' })).toBeDisabled()
    activating.resolve(license({ status: 'active', active: true, maskedKey: '••••-MNOP' }))
    await vi.waitFor(() => expect(controller.busy.value).toBe(false))
    expect(controller.keyDraft.value).toBe('')
    controller.dispose()
  })

  it('announces a provider failure once when the live state carries the same message', async () => {
    const activating = deferred<CommercialLicenseState>()
    const { activate, controller } = renderPanel()
    activate.mockImplementationOnce(() => activating.promise)
    controller.keyDraft.value = 'ABCD-EFGH-IJKL-MNOP'

    const operation = controller.activate()
    controller.accept(license({ message: 'Commercial license service unavailable' }))
    activating.reject(new Error('Commercial license service unavailable'))
    await expect(operation).resolves.toBe(false)

    expect(screen.getAllByText('Commercial license service unavailable')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Commercial license service unavailable')
    controller.dispose()
  })

  it('emits external support links without navigating inside the component', async () => {
    const { controller, rendered } = renderPanel()
    await userEvent.setup().click(screen.getByRole('button', { name: 'PolyForm Noncommercial license ↗' }))

    expect(rendered.emitted().openUrl).toEqual([['https://github.com/hronaut/hronaut/blob/main/LICENSE']])
    controller.dispose()
  })

  it('routes commercial purchase separately from Hronaut tab links', async () => {
    const { controller, rendered } = renderPanel()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buy commercial license ↗' }))

    expect(rendered.emitted().purchase).toEqual([[]])
    expect(rendered.emitted().openUrl).toBeUndefined()
    controller.dispose()
  })
})
