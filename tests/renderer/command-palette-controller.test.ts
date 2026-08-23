import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useCommandPaletteController } from '../../src/renderer/src/composables/useCommandPaletteController.js'

function createController(websiteAvailable = true) {
  const open = ref(false)
  const website = ref(websiteAvailable)
  const runCommand = vi.fn(async () => undefined)
  const onRunError = vi.fn()
  const controller = useCommandPaletteController({
    open,
    websiteAvailable: website,
    translate: (key) => key,
    runCommand,
    onRunError
  })
  return { open, website, runCommand, onRunError, controller }
}

describe('command palette controller', () => {
  it('preserves a selected global command when website-only commands disappear', async () => {
    const { website, controller } = createController(true)
    await controller.openPanel()
    controller.selection.value = controller.commands.value.findIndex((command) => command.id === 'settings')
    expect(controller.selectedCommand.value?.id).toBe('settings')

    website.value = false

    expect(controller.selectedCommand.value?.id).toBe('settings')
    expect(controller.selection.value).toBe(controller.commands.value.findIndex((command) => command.id === 'settings'))
    controller.dispose()
  })

  it('runs the still-selected command after live website availability changes', async () => {
    const { open, website, runCommand, controller } = createController(true)
    await controller.openPanel()
    controller.selection.value = controller.commands.value.findIndex((command) => command.id === 'settings')
    website.value = false

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledWith('settings'))

    expect(open.value).toBe(false)
    controller.dispose()
  })

  it('reports rejected keyboard commands without leaking an unhandled rejection', async () => {
    const { open, runCommand, onRunError, controller } = createController(true)
    const failure = new Error('downloads unavailable')
    runCommand.mockRejectedValueOnce(failure)
    await controller.openPanel()
    controller.selection.value = controller.commands.value.findIndex((command) => command.id === 'downloads')

    controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(onRunError).toHaveBeenCalledWith(failure, 'downloads'))

    expect(open.value).toBe(false)
    expect(runCommand).toHaveBeenCalledWith('downloads')
    controller.dispose()
  })

  it('resets selection to the strongest match when the query changes', async () => {
    const { controller } = createController(true)
    await controller.openPanel()
    controller.selection.value = 5
    controller.query.value = 'visible screen'
    await nextTick()

    expect(controller.selection.value).toBe(0)
    expect(controller.selectedCommand.value?.id).toBe('capture-viewport')
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

  it('restores input focus when a live availability change moves focus away', async () => {
    const { website, controller } = createController(true)
    const input = document.createElement('input')
    const outside = document.createElement('button')
    document.body.append(input, outside)
    controller.input.value = input
    await controller.openPanel()
    outside.focus()
    expect(document.activeElement).toBe(outside)

    website.value = false
    await nextTick()

    expect(document.activeElement).toBe(input)
    input.remove()
    outside.remove()
    controller.dispose()
  })
})
