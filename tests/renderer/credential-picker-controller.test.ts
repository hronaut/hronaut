import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useCredentialPickerController } from '../../src/renderer/src/composables/useCredentialPickerController.js'
import type { CredentialSummary } from '../../src/shared/types.js'

function credential(id: string, username: string, origin = 'https://example.test'): CredentialSummary {
  return {
    id,
    origin,
    username,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z'
  }
}

function createController(initialCredentials = [credential('alice', 'Alice'), credential('bob', 'Bob')]) {
  const open = ref(false)
  const credentials = ref(initialCredentials)
  const origin = ref<string | null>('https://example.test')
  const fillCredential = vi.fn(async () => undefined)
  const panel = ref<HTMLElement | null>(null)
  const controller = useCredentialPickerController({
    open,
    panel,
    credentials,
    origin,
    translate: (key) => key,
    fillCredential
  })
  return { open, credentials, origin, fillCredential, panel, controller }
}

describe('credential picker controller', () => {
  it('preserves the selected credential identity when live results are inserted or reordered', async () => {
    const { credentials, controller } = createController()
    await controller.openPanel()
    controller.selection.value = 1
    expect(controller.selectedCredential.value?.id).toBe('bob')

    credentials.value = [credential('carol', 'Carol'), credential('alice', 'Alice'), credential('bob', 'Bob')]

    expect(controller.selection.value).toBe(2)
    expect(controller.selectedCredential.value?.id).toBe('bob')
    controller.dispose()
  })

  it('runs the still-selected credential after another account is removed', async () => {
    const { open, credentials, fillCredential, controller } = createController()
    await controller.openPanel()
    controller.selection.value = 1
    credentials.value = [credential('bob', 'Bob')]

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(fillCredential).toHaveBeenCalledWith(expect.objectContaining({ id: 'bob' })))

    expect(open.value).toBe(false)
    controller.dispose()
  })

  it('does not fill a credential for the repeats of a held Enter', async () => {
    const { open, fillCredential, controller } = createController()
    await controller.openPanel()

    const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, cancelable: true })
    controller.handleKeydown(repeat)
    await Promise.resolve()

    // The picker opens with the focus in its search field, often from a button pressed with Enter, and the key's
    // repeats filled the first account without a choice.
    expect(repeat.defaultPrevented).toBe(true)
    expect(fillCredential).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(fillCredential).toHaveBeenCalledWith(expect.objectContaining({ id: 'alice' })))
    controller.dispose()
  })

  it('does not fill, move, or close while an IME composition owns the key', async () => {
    const { open, fillCredential, controller } = createController()
    await controller.openPanel()

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }))
    await Promise.resolve()

    expect(controller.selection.value).toBe(0)
    expect(fillCredential).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
    controller.dispose()
  })

  it('resets selection to the first match when the query changes', async () => {
    const { controller } = createController()
    await controller.openPanel()
    controller.selection.value = 1
    controller.query.value = 'alice'
    await nextTick()

    expect(controller.selection.value).toBe(0)
    expect(controller.selectedCredential.value?.id).toBe('alice')
    controller.dispose()
  })

  it('closes immediately when the active website origin changes', async () => {
    const { open, origin, controller } = createController()
    await controller.openPanel()

    origin.value = 'https://other.test'

    expect(open.value).toBe(false)
    controller.dispose()
  })

  it('does not reopen after it is closed while initial focus is pending', async () => {
    const { open, controller } = createController()
    const opening = controller.openPanel()
    controller.close()
    await opening

    expect(open.value).toBe(false)
    controller.dispose()
  })

  it('restores input focus after a live credential update moves focus away', async () => {
    const { credentials, controller } = createController()
    const input = document.createElement('input')
    const outside = document.createElement('button')
    document.body.append(input, outside)
    controller.input.value = input
    await controller.openPanel()
    outside.focus()

    credentials.value = [credential('alice', 'Alice'), credential('bob', 'Bob'), credential('carol', 'Carol')]
    await nextTick()

    expect(document.activeElement).toBe(input)
    input.remove()
    outside.remove()
    controller.dispose()
  })

  it.each(['close', 'reopen', 'origin', 'dispose'] as const)('drops queued focus recovery after %s', async action => {
    const { open, credentials, origin, controller } = createController()
    const input = document.createElement('input')
    document.body.append(input)
    controller.input.value = input
    await controller.openPanel()
    const focus = vi.spyOn(input, 'focus')
    credentials.value = [credential('bob', 'Bob')]
    if (action === 'dispose') controller.dispose()
    else if (action === 'origin') origin.value = 'https://other.test'
    else {
      controller.close()
      if (action === 'reopen') open.value = true
    }
    await nextTick()
    expect(focus).not.toHaveBeenCalled()
    input.remove()
    controller.dispose()
  })

  it('preserves a newer internal focus choice made while recovery is queued', async () => {
    const { credentials, panel, controller } = createController()
    const root = document.createElement('section')
    const input = document.createElement('input')
    const button = document.createElement('button')
    root.append(input, button)
    document.body.append(root)
    panel.value = root
    controller.input.value = input
    await controller.openPanel()
    credentials.value = [credential('bob', 'Bob')]
    button.focus()
    await nextTick()
    expect(button).toHaveFocus()
    root.remove()
    controller.dispose()
  })

  it('keeps deliberate initial focus for only the newest opening', async () => {
    const { controller } = createController()
    const input = document.createElement('input')
    document.body.append(input)
    controller.input.value = input
    const focus = vi.spyOn(input, 'focus')
    const oldOpening = controller.openPanel()
    controller.close()
    const newOpening = controller.openPanel()
    await Promise.all([oldOpening, newOpening])
    expect(input).toHaveFocus()
    expect(focus).toHaveBeenCalledTimes(1)
    input.remove()
    controller.dispose()
  })
})

it.each(['BOB example', 'example   bob', 'smith bob', '  bob\tSMITH  '])('matches all account chooser search terms: %s', query => {
  const { controller } = createController([
    credential('bob', 'Bob Smith'), credential('alice', 'Alice'),
    credential('foreign', 'Bob Smith', 'https://foreign.test')
  ])
  controller.query.value = query
  expect(controller.credentials.value.map(entry => entry.id)).toEqual(['bob'])
  controller.dispose()
})

it.each(['Bob Alice', 'hidden-id', '2026-08-22', 'foreign'])('rejects unrelated account or hidden metadata terms: %s', query => {
  const { controller } = createController([
    credential('hidden-id', 'Bob'), credential('alice', 'Alice'),
    credential('foreign', 'Bob', 'https://foreign.test')
  ])
  controller.query.value = query
  expect(controller.credentials.value).toEqual([])
  controller.dispose()
})

it('preserves origin scope and keyboard-selected identity while matching account search terms', async () => {
  const { controller, credentials, fillCredential, origin } = createController([
    credential('bob', 'Bob Smith'), credential('alice', 'Alice Smith'),
    credential('foreign', 'Carol Smith', 'https://foreign.test')
  ])
  await controller.openPanel()
  controller.query.value = 'smith example'
  await controller.moveSelection(1)
  expect(controller.selectedCredential.value?.id).toBe('alice')
  credentials.value = [credential('new', 'New Smith'), ...credentials.value]
  expect(controller.selectedCredential.value?.id).toBe('alice')
  controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
  await vi.waitFor(() => expect(fillCredential).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'alice' })))
  controller.query.value = '  '
  expect(controller.credentials.value.map(entry => entry.id)).toEqual(['new', 'bob', 'alice'])
  origin.value = null
  expect(controller.credentials.value).toEqual([])
  controller.dispose()
})

it('uses the supplied locale and translated unnamed label reactively', () => {
  const locale = ref('tr-TR')
  const unnamed = ref('Unnamed account')
  const controller = useCredentialPickerController({
    open: ref(true), origin: ref('https://example.test'),
    panel: ref(null),
    credentials: ref([credential('name', 'ISIK'), credential('unnamed', '')]),
    locale, translate: () => unnamed.value, fillCredential: vi.fn()
  })
  controller.query.value = 'ısık example'
  expect(controller.credentials.value.map(entry => entry.id)).toEqual(['name'])
  locale.value = 'en-US'
  expect(controller.credentials.value).toEqual([])
  controller.query.value = 'account unnamed'
  expect(controller.credentials.value.map(entry => entry.id)).toEqual(['unnamed'])
  unnamed.value = 'Безіменний обліковий запис'
  expect(controller.credentials.value).toEqual([])
  controller.query.value = 'запис БЕЗІМЕННИЙ'
  expect(controller.credentials.value.map(entry => entry.id)).toEqual(['unnamed'])
  controller.dispose()
})
