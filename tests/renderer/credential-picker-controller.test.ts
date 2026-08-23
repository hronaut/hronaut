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
  const controller = useCredentialPickerController({
    open,
    credentials,
    origin,
    translate: (key) => key,
    fillCredential
  })
  return { open, credentials, origin, fillCredential, controller }
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
})
