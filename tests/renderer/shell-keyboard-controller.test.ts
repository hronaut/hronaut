import { describe, expect, it, vi } from 'vitest'
import {
  useShellKeyboardController,
  type ShellKeyboardSurface
} from '../../src/renderer/src/composables/useShellKeyboardController.js'

function surface(initial = false): ShellKeyboardSurface & { open: boolean; close: ReturnType<typeof vi.fn> } {
  const value = {
    open: initial,
    close: vi.fn(() => { value.open = false }),
    isOpen: () => value.open
  }
  return value
}

function setup(options: {
  locked?: boolean
  commandPalette?: ShellKeyboardSurface
  modalSurfaces?: ShellKeyboardSurface[]
  escapeSurfaces?: ShellKeyboardSurface[]
} = {}) {
  const runShortcut = vi.fn()
  const commandPalette = options.commandPalette ?? surface()
  const controller = useShellKeyboardController({
    allInteractionLocked: () => options.locked ?? false,
    commandPalette,
    modalSurfaces: options.modalSurfaces ?? [],
    escapeSurfaces: options.escapeSurfaces ?? [],
    runShortcut
  })
  return { controller, commandPalette, runShortcut }
}

describe('useShellKeyboardController', () => {
  it('leaves shell surfaces open when Escape belongs to an IME composition', () => {
    const commandPalette = surface(true)
    const modal = surface(true)
    const panel = surface(true)
    const { controller } = setup({ commandPalette, modalSurfaces: [modal], escapeSurfaces: [panel] })

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }))

    expect(commandPalette.close).not.toHaveBeenCalled()
    expect(modal.close).not.toHaveBeenCalled()
    expect(panel.close).not.toHaveBeenCalled()
  })

  it('recognizes Chromium process-key fallback events as IME composition', () => {
    const commandPalette = surface(true)
    const { controller } = setup({ commandPalette })
    const processKey = new KeyboardEvent('keydown', { key: 'Escape' })
    Object.defineProperty(processKey, 'keyCode', { value: 229 })

    controller.handleKeyDown(processKey)

    expect(commandPalette.close).not.toHaveBeenCalled()
  })

  it('keeps command-palette input modal while allowing its own toggle shortcut', () => {
    const commandPalette = surface(true)
    const { controller, runShortcut } = setup({ commandPalette })

    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, cancelable: true }))
    expect(runShortcut).not.toHaveBeenCalled()

    const toggle = new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, cancelable: true })
    controller.handleKeyDown(toggle)
    expect(toggle.defaultPrevented).toBe(true)
    expect(runShortcut).toHaveBeenCalledWith('command-palette')
  })

  it('closes only the highest-priority modal or Escape surface', () => {
    const firstModal = surface(true)
    const secondModal = surface(true)
    const firstPanel = surface(true)
    const secondPanel = surface(true)
    const { controller } = setup({
      modalSurfaces: [firstModal, secondModal],
      escapeSurfaces: [firstPanel, secondPanel]
    })
    const modalEscape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    controller.handleKeyDown(modalEscape)

    expect(modalEscape.defaultPrevented).toBe(true)
    expect(firstModal.close).toHaveBeenCalledOnce()
    expect(secondModal.close).not.toHaveBeenCalled()
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(secondModal.close).toHaveBeenCalledOnce()
    controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(firstPanel.close).toHaveBeenCalledOnce()
    expect(secondPanel.close).not.toHaveBeenCalled()
  })

  it('blocks lock-protected close controls before their event handlers run', () => {
    const { controller } = setup({ locked: true })
    const protectedControl = document.createElement('span')
    protectedControl.dataset.lockProtectedTabClose = ''
    const icon = document.createElement('span')
    protectedControl.append(icon)
    icon.addEventListener('click', controller.guardInteraction)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    icon.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
  })
})
