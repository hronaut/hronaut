import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useHelpShellController } from '../../src/renderer/src/composables/useHelpShellController.js'

function createController(overrides: Partial<Parameters<typeof useHelpShellController>[0]> = {}) {
  const commandPaletteOpen = ref(true)
  const options: Parameters<typeof useHelpShellController>[0] = {
    commandPaletteOpen,
    blocked: () => false,
    closeSettings: vi.fn(),
    closeHelpDialog: vi.fn(),
    showHelpDialog: vi.fn(),
    showSupportSettings: vi.fn(),
    navigate: vi.fn(async () => undefined),
    openPurchase: vi.fn(async () => undefined),
    runAction: vi.fn(async (action: () => unknown) => {
      try {
        await action()
        return true
      } catch {
        return false
      }
    }),
    ...overrides
  }

  return { commandPaletteOpen, options, controller: useHelpShellController(options) }
}

describe('Help shell controller', () => {
  it('opens Help dialogs after closing competing shell surfaces', () => {
    const { commandPaletteOpen, options, controller } = createController()

    controller.openDialog('shortcuts')

    expect(commandPaletteOpen.value).toBe(false)
    expect(options.closeSettings).toHaveBeenCalledOnce()
    expect(options.showHelpDialog).toHaveBeenCalledWith('shortcuts')
  })

  it('ignores native Help requests while a blocking editor is open', () => {
    const { commandPaletteOpen, options, controller } = createController({ blocked: () => true })

    controller.handleRequested('about')
    controller.handleRequested('support')

    expect(commandPaletteOpen.value).toBe(true)
    expect(options.closeSettings).not.toHaveBeenCalled()
    expect(options.showHelpDialog).not.toHaveBeenCalled()
    expect(options.showSupportSettings).not.toHaveBeenCalled()
  })

  it('routes a native support request to Support settings', () => {
    const { options, controller } = createController()

    controller.handleRequested('support')

    expect(options.showSupportSettings).toHaveBeenCalledOnce()
    expect(options.showHelpDialog).not.toHaveBeenCalled()
  })

  it('closes Help surfaces and contains failed link navigation through the shared action boundary', async () => {
    const failure = new Error('navigation unavailable')
    const navigate = vi.fn(async () => { throw failure })
    const { options, controller } = createController({ navigate })

    await expect(controller.openUrl('https://hronaut.dev/support')).resolves.toBeUndefined()

    expect(options.closeHelpDialog).toHaveBeenCalledOnce()
    expect(options.closeSettings).toHaveBeenCalledOnce()
    expect(options.runAction).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('https://hronaut.dev/support')
  })

  it('opens commercial licensing through the shared action boundary', async () => {
    const { options, controller } = createController()

    controller.purchaseCommercialLicense()
    await vi.waitFor(() => expect(options.openPurchase).toHaveBeenCalledOnce())

    expect(options.runAction).toHaveBeenCalledOnce()
  })
})
