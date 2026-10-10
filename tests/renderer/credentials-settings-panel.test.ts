import { nextTick } from 'vue'
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

function renderPanel(entries = [savedCredential]) {
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
  controller.replace(entries)
  const view = render(CredentialsSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { api, controller, view }
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
    expect(remove).toHaveAttribute('aria-disabled', 'true')
    expect(remove).not.toBeDisabled()
    await user.keyboard('{Enter}')
    removing.reject(new Error('cannot update credential vault'))

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot update credential vault')
    expect(screen.getByText('Person')).toBeVisible()
    expect(remove).not.toBeDisabled()
    expect(api.remove).toHaveBeenCalledOnce()
    expect(remove).toHaveFocus()
    controller.dispose()
  })
})

const entries = ['Alpha', 'Middle', 'Zulu'].map(username => ({ ...savedCredential, id: username, username }))
const removeName = (entry: CredentialSummary) => `Remove saved password for ${entry.username} on ${entry.origin}`

it.each([0, 1, 2])('moves focus to a neighboring password after removing row %i', async index => {
  const { api, controller } = renderPanel(entries)
  await userEvent.setup().click(screen.getByRole('button', { name: removeName(entries[index]) }))
  await vi.waitFor(() => expect(screen.getByRole('button', { name: removeName(entries[index === 2 ? 1 : index + 1]) })).toHaveFocus())
  expect(api.remove).toHaveBeenCalledExactlyOnceWith(entries[index].id)
  controller.dispose()
})

it('focuses the saved-password heading after removing the final password', async () => {
  const { controller } = renderPanel()
  await userEvent.setup().click(screen.getByRole('button', { name: removeName(savedCredential) }))
  await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Saved passwords' })).toHaveFocus())
  expect(screen.getByText('No saved passwords')).toBeVisible()
  controller.dispose()
})

it('preserves newer focus when a pending removal completes', async () => {
  const { api, controller } = renderPanel(entries)
  let resolve!: (removed: boolean) => void
  api.remove.mockReturnValueOnce(new Promise(done => { resolve = done }))
  await userEvent.setup().click(screen.getByRole('button', { name: removeName(entries[1]) }))
  const newer = screen.getByRole('button', { name: removeName(entries[0]) })
  newer.focus()
  resolve(true)
  await vi.waitFor(() => expect(controller.entries.value).toHaveLength(2))
  expect(newer).toHaveFocus()
  controller.dispose()
})

it('recovers focus after a live inventory removes the focused password', async () => {
  const { controller } = renderPanel(entries)
  screen.getByRole('button', { name: removeName(entries[1]) }).focus()
  controller.replace([entries[0], entries[2]])
  await vi.waitFor(() => expect(screen.getByRole('button', { name: removeName(entries[2]) })).toHaveFocus())
  controller.dispose()
})

it('keeps a retained password focused when another row disappears', async () => {
  const { controller } = renderPanel(entries)
  const retained = screen.getByRole('button', { name: removeName(entries[2]) })
  retained.focus()
  controller.replace([entries[0], entries[2]])
  await nextTick()
  expect(retained).toHaveFocus()
  controller.dispose()
})

it('does not restore old password focus after unmount', async () => {
  const { api, controller, view } = renderPanel(entries)
  let resolve!: (removed: boolean) => void
  api.remove.mockReturnValueOnce(new Promise(done => { resolve = done }))
  await userEvent.setup().click(screen.getByRole('button', { name: removeName(entries[1]) }))
  view.unmount()
  const newer = document.createElement('button')
  document.body.append(newer)
  newer.focus()
  resolve(true)
  await vi.waitFor(() => expect(controller.entries.value).toHaveLength(2))
  expect(newer).toHaveFocus()
  newer.remove()
  controller.dispose()
})
