import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CredentialsSettingsPanel from '../../src/renderer/src/components/CredentialsSettingsPanel.vue'
import { useCredentialsController } from '../../src/renderer/src/composables/useCredentialsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { CredentialSummary } from '../../src/shared/types.js'

const savedCredential: CredentialSummary = {
  id: 'person',
  origin: 'https://example.test',
  username: 'Person',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z'
}

function deferred<Value>() {
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((_resolve, fail) => { reject = fail })
  return { promise, reject }
}

function renderPanel() {
  const api = {
    importFromCsv: vi.fn(async () => ({ canceled: true, added: 0, updated: 0, skipped: 0 })),
    remove: vi.fn(async () => true)
  }
  const controller = useCredentialsController({
    api,
    initializingReason: 'Initializing secure storage',
    missingCredentialMessage: () => 'Saved credential no longer exists',
    formatError: (error) => error instanceof Error ? error.message : String(error),
    onRemoved: vi.fn(),
    onError: vi.fn()
  })
  controller.storage.value = { available: true, backend: 'test vault' }
  controller.replace([savedCredential])
  render(CredentialsSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { api, controller }
}

describe('CredentialsSettingsPanel', () => {
  it('renders saved credential metadata without exposing password fields', () => {
    const { controller } = renderPanel()

    expect(screen.getByRole('heading', { name: 'Saved passwords' })).toBeVisible()
    expect(screen.getByText('Person')).toBeVisible()
    expect(screen.getByText('https://example.test')).toBeVisible()
    expect(screen.queryByLabelText(/password/i, { selector: 'input' })).not.toBeInTheDocument()
    controller.dispose()
  })

  it('disables repeated removal and retains the row after persistence failure', async () => {
    const removing = deferred<boolean>()
    const { api, controller } = renderPanel()
    api.remove.mockImplementationOnce(() => removing.promise)
    const user = userEvent.setup()
    const remove = screen.getByRole('button', { name: 'Remove saved password for Person on https://example.test' })

    await user.click(remove)
    expect(remove).toBeDisabled()
    removing.reject(new Error('cannot update credential vault'))

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot update credential vault')
    expect(screen.getByText('Person')).toBeVisible()
    expect(remove).not.toBeDisabled()
    expect(api.remove).toHaveBeenCalledOnce()
    controller.dispose()
  })
})
