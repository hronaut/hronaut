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

  it('closes one surface for a held Escape, not one for each repeat', () => {
    const commandPalette = surface(true)
    const modal = surface(true)
    const nextModal = surface(true)
    const panel = surface(true)
    const nextPanel = surface(true)
    const { controller } = setup({ commandPalette, modalSurfaces: [modal, nextModal], escapeSurfaces: [panel, nextPanel] })
    const press = () => controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    const repeat = () => controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', repeat: true, cancelable: true }))

    press()
    repeat()
    repeat()
    expect(commandPalette.close).toHaveBeenCalledTimes(1)
    expect(modal.close).not.toHaveBeenCalled()

    press()
    repeat()
    expect(modal.close).toHaveBeenCalledTimes(1)
    expect(nextModal.close).not.toHaveBeenCalled()
    // An open modal still takes the repeats, so a search field under it does not clear itself.
    const repeatInModal = new KeyboardEvent('keydown', { key: 'Escape', repeat: true, cancelable: true })
    controller.handleKeyDown(repeatInModal)
    expect(repeatInModal.defaultPrevented).toBe(true)
    expect(nextModal.close).not.toHaveBeenCalled()

    press()
    press()
    repeat()
    repeat()
    expect(nextModal.close).toHaveBeenCalledTimes(1)
    expect(panel.close).toHaveBeenCalledTimes(1)
    expect(nextPanel.close).not.toHaveBeenCalled()
  })

  it('closes a surface in its own window only after every open surface of this window', () => {
    let ownWindow = true
    const separate = Object.assign(surface(true), { inOwnWindow: () => ownWindow })
    const first = surface(true)
    const second = surface(true)
    const { controller } = setup({ escapeSurfaces: [separate, first, second] })
    const escape = (repeat = false) => controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', repeat }))

    escape()
    expect(first.close).toHaveBeenCalledOnce()
    expect(separate.close).not.toHaveBeenCalled()
    escape(true)
    expect(second.close).not.toHaveBeenCalled()
    escape()
    expect(second.close).toHaveBeenCalledOnce()
    // A repeat reaches nothing, here or in the other window.
    escape(true)
    expect(separate.close).not.toHaveBeenCalled()
    escape()
    expect(separate.close).toHaveBeenCalledOnce()

    // Back in this window, the surface keeps its place in the order.
    separate.open = true
    first.open = true
    ownWindow = false
    escape()
    expect(separate.close).toHaveBeenCalledTimes(2)
    expect(first.open).toBe(true)
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

  it('lets Ctrl/Cmd+K through the open palette, which closes the switcher or turns to it', () => {
    const commandPalette = surface(true)
    const { controller, runShortcut } = setup({ commandPalette })

    const toggle = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true })
    controller.handleKeyDown(toggle)
    expect(toggle.defaultPrevented).toBe(true)
    expect(runShortcut).toHaveBeenCalledWith('switch-workspace')
    expect(commandPalette.close).not.toHaveBeenCalled()
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
