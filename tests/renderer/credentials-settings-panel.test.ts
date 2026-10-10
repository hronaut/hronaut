import { nextTick } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  const i18n = createHronautI18n('en-US')
  const view = render(CredentialsSettingsPanel, {
    global: { plugins: [i18n] },
    props: { controller }
  })
  return { api, controller, view, i18n }
}

describe('CredentialsSettingsPanel', () => {
  it('renders saved credential metadata without exposing password fields', () => {
    const { controller } = renderPanel()

    expect(screen.getByRole('heading', { name: 'Saved passwords' })).toBeVisible()
    expect(screen.getByText('Person')).toBeVisible()
    expect(screen.getByText('https://example.test')).toBeVisible()
    expect(screen.queryByLabelText(/password/i, { selector: 'input:not([type="search"])' })).not.toBeInTheDocument()
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

let restoreShell: (() => void) | undefined
afterEach(() => { restoreShell?.(); restoreShell = undefined; vi.restoreAllMocks() })
function installFocusCheck(isWindowFocused: () => Promise<boolean>): void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'hronautShell')
  Object.defineProperty(window, 'hronautShell', { configurable: true, value: { isWindowFocused } })
  restoreShell = () => {
    if (descriptor) Object.defineProperty(window, 'hronautShell', descriptor)
    else Reflect.deleteProperty(window, 'hronautShell')
  }
}

for (const mode of ['neighbor', 'heading', 'retained'] as const) {
  for (const rejects of [false, true]) {
    it(`does not restore ${mode} password focus without native authority (rejects: ${rejects})`, async () => {
      const { controller } = renderPanel(mode === 'heading' ? [savedCredential] : entries)
      const original = screen.getByRole('button', { name: removeName(mode === 'heading' ? savedCredential : entries[mode === 'retained' ? 2 : 1]) })
      original.focus()
      const target = mode === 'heading' ? screen.getByRole('heading', { name: 'Saved passwords' })
        : screen.getByRole('button', { name: removeName(entries[2]) })
      const focus = vi.spyOn(target, 'focus')
      const check = vi.fn(async () => { if (rejects) throw new Error('Focus unavailable'); return false })
      installFocusCheck(check)
      controller.replace(mode === 'heading' ? [] : [entries[0], entries[2]])
      await flushPromises()
      expect(focus).not.toHaveBeenCalled()
      expect(check).toHaveBeenCalledOnce()
      controller.dispose()
    })
  }
}

for (const race of ['moved', 'outside-moved', 'superseded', 'unmounted', 'pending-target'] as const) {
  it(`does not restore stale password focus after a delayed native check: ${race}`, async () => {
    const { controller, api, view } = renderPanel(entries)
    screen.getByRole('button', { name: removeName(entries[1]) }).focus()
    const target = screen.getByRole('button', { name: removeName(entries[2]) })
    const focus = vi.spyOn(target, 'focus')
    let resolveFocus!: (value: boolean) => void
    const pendingFocus = new Promise<boolean>(resolve => { resolveFocus = resolve })
    const check = vi.fn(() => pendingFocus)
    installFocusCheck(check)
    controller.replace([entries[0], entries[2]])
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce())
    let finishRemoval: ((value: boolean) => void) | undefined
    let outside: HTMLInputElement | undefined
    if (race === 'moved') {
      const search = screen.getByRole('searchbox', { name: 'Search saved passwords' })
      search.focus()
      search.blur()
    } else if (race === 'outside-moved') {
      outside = document.createElement('input')
      outside.type = 'search'
      outside.addEventListener('focusin', event => event.stopPropagation())
      document.body.append(outside)
      outside.focus()
      expect(outside).toHaveFocus()
      outside.blur()
      expect(document.body).toHaveFocus()
    } else if (race === 'superseded') controller.replace([entries[0]])
    else if (race === 'unmounted') view.unmount()
    else {
      api.remove.mockReturnValueOnce(new Promise(resolve => { finishRemoval = resolve }))
      void controller.remove(entries[2].id)
    }
    await flushPromises()
    resolveFocus(true)
    await flushPromises()
    outside?.remove()
    expect(focus).not.toHaveBeenCalled()
    finishRemoval?.(false)
    await flushPromises()
    controller.dispose()
  })
}

it('removes the document focus observer when each password panel unmounts', () => {
  const add = vi.spyOn(document, 'addEventListener')
  const remove = vi.spyOn(document, 'removeEventListener')
  for (let index = 0; index < 2; index += 1) {
    add.mockClear()
    remove.mockClear()
    const { controller, view } = renderPanel(entries)
    const observers = add.mock.calls.filter(([type, , capture]) => type === 'focusin' && capture === true)
    expect(observers).toHaveLength(1)
    view.unmount()
    expect(remove.mock.calls.filter(([type, listener, capture]) => type === 'focusin'
      && listener === observers[0][1] && capture === true)).toHaveLength(1)
    controller.dispose()
  }
})

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

it('searches words across saved username and origin without changing retained accounts', async () => {
  const { controller } = renderPanel(entries)
  const search = screen.getByRole('searchbox', { name: 'Search saved passwords' })
  await userEvent.setup().type(search, 'EXAMPLE   middle')
  expect(screen.getAllByRole('button', { name: /Remove saved password for/ })).toHaveLength(1)
  expect(screen.getByRole('button', { name: removeName(entries[1]) })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('1 of 3 saved passwords')
  expect(controller.entries.value).toHaveLength(3)
  controller.dispose()
})

it.each(['Alpha Zulu', 'person', '2026-08-22', 'unknown'])('does not match unrelated rows or hidden metadata: %s', async query => {
  const { controller } = renderPanel(entries.map(entry => ({ ...entry, id: `person-${entry.id}` })))
  await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search saved passwords' }), query)
  expect(screen.queryByRole('button', { name: /Remove saved password for/ })).not.toBeInTheDocument()
  expect(screen.getByText('No saved passwords match this search.')).toBeVisible()
  expect(screen.queryByText('No saved passwords')).not.toBeInTheDocument()
  expect(controller.entries.value).toHaveLength(3)
  controller.dispose()
})

it('clears a search back to stable account order', async () => {
  const { controller } = renderPanel(entries)
  const user = userEvent.setup()
  const search = screen.getByRole('searchbox', { name: 'Search saved passwords' })
  await user.type(search, 'Zulu')
  await user.clear(search)
  expect(screen.getAllByRole('button', { name: /Remove saved password for/ }).map(button => button.getAttribute('aria-label'))).toEqual(entries.map(removeName))
  expect(search).toHaveFocus()
  controller.dispose()
})

it('removes only the filtered account and retains hidden accounts', async () => {
  const { api, controller } = renderPanel(entries)
  const user = userEvent.setup()
  await user.type(screen.getByRole('searchbox', { name: 'Search saved passwords' }), 'Middle example')
  await user.click(screen.getByRole('button', { name: removeName(entries[1]) }))
  await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Saved passwords' })).toHaveFocus())
  expect(api.remove).toHaveBeenCalledExactlyOnceWith('Middle')
  expect(controller.entries.value.map(entry => entry.id)).toEqual(['Alpha', 'Zulu'])
  expect(screen.getByRole('status')).toHaveTextContent('0 of 2 saved passwords')
  controller.dispose()
})

it('refreshes filtered metadata after a live credential update', async () => {
  const { controller } = renderPanel(entries)
  const search = screen.getByRole('searchbox', { name: 'Search saved passwords' })
  await userEvent.setup().type(search, 'new-person new.test')
  controller.replace([...entries, { ...savedCredential, id: 'new', username: 'new-person', origin: 'https://new.test' }])
  expect(await screen.findByRole('button', { name: 'Remove saved password for new-person on https://new.test' })).toBeVisible()
  expect(search).toHaveFocus()
  expect(screen.getByRole('status')).toHaveTextContent('1 of 4 saved passwords')
  controller.dispose()
})

it('searches the displayed unnamed-account label and reacts to locale changes', async () => {
  const { controller, i18n } = renderPanel([{ ...savedCredential, username: '' }])
  const search = screen.getByRole('searchbox', { name: 'Search saved passwords' })
  await userEvent.setup().type(search, 'unnamed example')
  expect(screen.getByRole('status')).toHaveTextContent('1 of 1 saved passwords')
  i18n.global.locale.value = 'uk-UA'
  await nextTick()
  expect(screen.queryByRole('button', { name: /https:\/\/example.test/ })).not.toBeInTheDocument()
  await userEvent.setup().clear(search)
  await userEvent.setup().type(search, i18n.global.t('credentialPicker.unnamed'))
  expect(screen.getByRole('button', { name: /https:\/\/example.test/ })).toBeVisible()
  expect(search).toHaveFocus()
  controller.dispose()
})

it('hides account search while secure storage is unavailable', async () => {
  const { controller } = renderPanel()
  controller.storage.value = { available: false, reason: 'Secure storage unavailable' }
  await nextTick()
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Remove saved password/ })).not.toBeInTheDocument()
  expect(screen.getByText('Secure storage unavailable')).toBeVisible()
  controller.dispose()
})

it('preserves a newer search while a pending removal finishes', async () => {
  const { api, controller } = renderPanel(entries)
  let resolve!: (removed: boolean) => void
  api.remove.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: removeName(entries[1]) }))
  const search = screen.getByRole('searchbox', { name: 'Search saved passwords' })
  await user.type(search, 'Zulu')
  resolve(true)
  await vi.waitFor(() => expect(controller.entries.value).toHaveLength(2))
  expect(search).toHaveFocus()
  expect(search).toHaveValue('Zulu')
  expect(screen.getAllByRole('button', { name: /Remove saved password for/ })).toHaveLength(1)
  expect(screen.getByRole('button', { name: removeName(entries[2]) })).toBeVisible()
  controller.dispose()
})
